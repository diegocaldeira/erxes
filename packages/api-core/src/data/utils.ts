import * as AWS from 'aws-sdk';
import utils from '@erxes/api-utils/src';
import * as fileType from 'file-type';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsxPopulate from 'xlsx-populate';
import { IUserDocument } from '../db/models/definitions/users';
import { debugBase, debugError } from '../debuggers';
import memoryStorage from '../inmemoryStorage';
import { graphqlPubsub } from '../pubsub';
import csvParser = require('csv-parser');
import * as readline from 'readline';
import * as _ from 'underscore';
import {
  Configs,
  EmailDeliveries,
  OnboardingHistories,
  Users
} from '../db/models';
import * as Handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { EMAIL_DELIVERY_STATUS } from '../db/models/definitions/constants';
export interface IEmailParams {
  toEmails?: string[];
  fromEmail?: string;
  title?: string;
  customHtml?: string;
  customHtmlData?: any;
  template?: { name?: string; data?: any };
  attachments?: object[];
  modifier?: (data: any, email: string) => void;
}

/**
 * Read contents of a file
 */
export const readFile = (filename: string) => {
  let folder = 'dist';

  if (process.env.NODE_ENV !== 'production') {
    folder = 'src';
  }

  if (fs.existsSync('./build/api')) {
    folder = 'build/api';
  }

  const filePath = `./${folder}/private/emailTemplates/${filename}.html`;

  return fs.readFileSync(filePath, 'utf8');
};

/**
 * Apply template
 */
const applyTemplate = async (data: any, templateName: string) => {
  let template: any = await readFile(templateName);

  template = Handlebars.compile(template.toString());

  return template(data);
};

export const sendEmail = async (params: IEmailParams) => {
  const {
    toEmails = [],
    fromEmail,
    title,
    customHtml,
    customHtmlData,
    template = {},
    modifier,
    attachments
  } = params;

  const NODE_ENV = getEnv({ name: 'NODE_ENV' });
  const DEFAULT_EMAIL_SERVICE = await getConfig('DEFAULT_EMAIL_SERVICE', 'SES');
  const defaultTemplate = await getConfig('COMPANY_EMAIL_TEMPLATE');
  const defaultTemplateType = await getConfig('COMPANY_EMAIL_TEMPLATE_TYPE');
  const COMPANY_EMAIL_FROM = await getConfig('COMPANY_EMAIL_FROM', '');
  const AWS_SES_CONFIG_SET = await getConfig('AWS_SES_CONFIG_SET', '');
  const AWS_SES_ACCESS_KEY_ID = await getConfig('AWS_SES_ACCESS_KEY_ID', '');
  const AWS_SES_SECRET_ACCESS_KEY = await getConfig(
    'AWS_SES_SECRET_ACCESS_KEY',
    ''
  );
  const MAIN_APP_DOMAIN = getEnv({ name: 'MAIN_APP_DOMAIN' });

  // do not send email it is running in test mode
  if (NODE_ENV === 'test') {
    return;
  }

  // try to create transporter or throw configuration error
  let transporter;

  try {
    transporter = await createTransporter({
      ses: DEFAULT_EMAIL_SERVICE === 'SES'
    });
  } catch (e) {
    return debugError(e.message);
  }

  const { data = {}, name } = template;

  // for unsubscribe url
  data.domain = MAIN_APP_DOMAIN;

  for (const toEmail of toEmails) {
    if (modifier) {
      modifier(data, toEmail);
    }

    // generate email content by given template
    let html;

    if (name) {
      html = await applyTemplate(data, name);
    } else if (
      !defaultTemplate ||
      !defaultTemplateType ||
      (defaultTemplateType && defaultTemplateType.toString() === 'simple')
    ) {
      html = await applyTemplate(data, 'base');
    } else if (defaultTemplate) {
      html = Handlebars.compile(defaultTemplate.toString())(data || {});
    }

    if (customHtml) {
      html = Handlebars.compile(customHtml)(customHtmlData || {});
    }

    const mailOptions: any = {
      from: fromEmail || COMPANY_EMAIL_FROM,
      to: toEmail,
      subject: title,
      html,
      attachments
    };

    if (!mailOptions.from) {
      throw new Error(`"From" email address is missing: ${mailOptions.from}`);
    }

    let headers: { [key: string]: string } = {};

    if (
      AWS_SES_ACCESS_KEY_ID.length > 0 &&
      AWS_SES_SECRET_ACCESS_KEY.length > 0
    ) {
      const emailDelivery = await EmailDeliveries.create({
        kind: 'transaction',
        to: toEmail,
        from: mailOptions.from,
        subject: title,
        body: html,
        status: EMAIL_DELIVERY_STATUS.PENDING
      });

      headers = {
        'X-SES-CONFIGURATION-SET': AWS_SES_CONFIG_SET || 'erxes',
        EmailDeliveryId: emailDelivery._id
      };
    } else {
      headers['X-SES-CONFIGURATION-SET'] = 'erxes';
    }

    mailOptions.headers = headers;

    return transporter.sendMail(mailOptions, (error, info) => {
      debugError(error);
      debugError(info);
    });
  }
};

/**
 * Create default or ses transporter
 */
export const createTransporter = async ({ ses }) => {
  if (ses) {
    const AWS_SES_ACCESS_KEY_ID = await getConfig('AWS_SES_ACCESS_KEY_ID');
    const AWS_SES_SECRET_ACCESS_KEY = await getConfig(
      'AWS_SES_SECRET_ACCESS_KEY'
    );
    const AWS_REGION = await getConfig('AWS_REGION');

    AWS.config.update({
      region: AWS_REGION,
      accessKeyId: AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: AWS_SES_SECRET_ACCESS_KEY
    });

    return nodemailer.createTransport({
      SES: new AWS.SES({ apiVersion: '2010-12-01' })
    });
  }

  const MAIL_SERVICE = await getConfig('MAIL_SERVICE');
  const MAIL_PORT = await getConfig('MAIL_PORT');
  const MAIL_USER = await getConfig('MAIL_USER');
  const MAIL_PASS = await getConfig('MAIL_PASS');
  const MAIL_HOST = await getConfig('MAIL_HOST');

  let auth;

  if (MAIL_USER && MAIL_PASS) {
    auth = {
      user: MAIL_USER,
      pass: MAIL_PASS
    };
  }

  return nodemailer.createTransport({
    service: MAIL_SERVICE,
    host: MAIL_HOST,
    port: MAIL_PORT,
    auth
  });
};

export const uploadsFolderPath = path.join(__dirname, '../private/uploads');

export const initFirebase = async (): Promise<void> => {
  const config = await Configs.findOne({
    code: 'GOOGLE_APPLICATION_CREDENTIALS_JSON'
  });

  if (!config) {
    return;
  }

  const codeString = config.value || 'value';

  if (codeString[0] === '{' && codeString[codeString.length - 1] === '}') {
    const serviceAccount = JSON.parse(codeString);

    if (serviceAccount.private_key) {
      await admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
  }
};

export const getS3FileInfo = async ({ s3, query, params }): Promise<string> => {
  return new Promise((resolve, reject) => {
    s3.selectObjectContent(
      {
        ...params,
        ExpressionType: 'SQL',
        Expression: query,
        InputSerialization: {
          CSV: {
            FileHeaderInfo: 'NONE',
            RecordDelimiter: '\n',
            FieldDelimiter: ',',
            AllowQuotedRecordDelimiter: true
          }
        },
        OutputSerialization: {
          CSV: {
            RecordDelimiter: '\n',
            FieldDelimiter: ','
          }
        }
      },
      (error, data) => {
        if (error) {
          return reject(error);
        }

        if (!data) {
          return reject('Failed to get file info');
        }

        // data.Payload is a Readable Stream
        const eventStream: any = data.Payload;

        let result;

        // Read events as they are available
        eventStream.on('data', event => {
          if (event.Records) {
            result = event.Records.Payload.toString();
          }
        });
        eventStream.on('end', () => {
          resolve(result);
        });
      }
    );
  });
};

export const getImportCsvInfo = async (fileName: string) => {
  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  return new Promise(async (resolve, reject) => {
    if (UPLOAD_SERVICE_TYPE === 'local') {
      const results = [] as any;
      let i = 0;

      const readStream = fs.createReadStream(
        `${uploadsFolderPath}/${fileName}`
      );

      readStream
        .pipe(csvParser())
        .on('data', data => {
          i++;
          if (i <= 3) {
            results.push(data);
          }
          if (i >= 3) {
            resolve(results);
          }
        })
        .on('close', () => {
          resolve(results);
        })
        .on('error', () => {
          reject();
        });
    } else {
      const AWS_BUCKET = await getConfig('AWS_BUCKET');
      const s3 = await createAWS();

      const params = { Bucket: AWS_BUCKET, Key: fileName };

      const request = s3.getObject(params);
      const readStream = request.createReadStream();

      const results = [] as any;
      let i = 0;

      readStream
        .pipe(csvParser())
        .on('data', data => {
          i++;
          if (i <= 3) {
            results.push(data);
          }
          if (i >= 3) {
            resolve(results);
          }
        })

        .on('close', () => {
          resolve(results);
        })
        .on('error', () => {
          reject();
        });
    }
  });
};

export const getCsvHeadersInfo = async (fileName: string) => {
  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  return new Promise(async resolve => {
    if (UPLOAD_SERVICE_TYPE === 'local') {
      const readSteam = fs.createReadStream(`${uploadsFolderPath}/${fileName}`);

      let columns;
      let total = 0;

      const rl = readline.createInterface({
        input: readSteam,
        terminal: false
      });

      rl.on('line', input => {
        if (total === 0) {
          columns = input;
        }

        if (total > 0) {
          resolve(columns);
        }

        total++;
      });

      rl.on('close', () => {
        resolve(columns);
      });
    } else {
      const AWS_BUCKET = await getConfig('AWS_BUCKET');
      const s3 = await createAWS();

      const params = { Bucket: AWS_BUCKET, Key: fileName };

      // exclude column

      const columns = await getS3FileInfo({
        s3,
        params,
        query: 'SELECT * FROM S3Object LIMIT 1'
      });

      return resolve(columns);
    }
  });
};

/*
 * Check that given file is not harmful
 */
export const checkFile = async (file, source?: string) => {
  if (!file) {
    throw new Error('Invalid file');
  }

  const { size } = file;

  // 20mb
  if (size > 20 * 1024 * 1024) {
    return 'Too large file';
  }

  // read file
  const buffer = await fs.readFileSync(file.path);

  // determine file type using magic numbers
  const ft = fileType(buffer);

  const unsupportedMimeTypes = [
    'text/csv',
    'image/svg+xml',
    'text/plain',
    'application/vnd.ms-excel'
  ];

  const oldMsOfficeDocs = [
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint'
  ];

  // allow csv, svg to be uploaded
  if (!ft && unsupportedMimeTypes.includes(file.type)) {
    return 'ok';
  }

  if (!ft) {
    return 'Invalid file type';
  }

  const { mime } = ft;

  // allow old ms office docs to be uploaded
  if (mime === 'application/x-msi' && oldMsOfficeDocs.includes(file.type)) {
    return 'ok';
  }

  const defaultMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'image/gif'
  ];

  const UPLOAD_FILE_TYPES = await getConfig(
    source === 'widgets' ? 'WIDGETS_UPLOAD_FILE_TYPES' : 'UPLOAD_FILE_TYPES'
  );

  if (
    !(
      (UPLOAD_FILE_TYPES && UPLOAD_FILE_TYPES.split(',')) ||
      defaultMimeTypes
    ).includes(mime)
  ) {
    return 'Invalid configured file type';
  }

  return 'ok';
};

/**
 * Create AWS instance
 */
export const createAWS = async () => {
  const AWS_ACCESS_KEY_ID = await getConfig('AWS_ACCESS_KEY_ID');
  const AWS_SECRET_ACCESS_KEY = await getConfig('AWS_SECRET_ACCESS_KEY');
  const AWS_BUCKET = await getConfig('AWS_BUCKET');
  const AWS_COMPATIBLE_SERVICE_ENDPOINT = await getConfig(
    'AWS_COMPATIBLE_SERVICE_ENDPOINT'
  );
  const AWS_FORCE_PATH_STYLE = await getConfig('AWS_FORCE_PATH_STYLE');

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_BUCKET) {
    throw new Error('AWS credentials are not configured');
  }

  const options: {
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    s3ForcePathStyle?: boolean;
  } = {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  };

  if (AWS_FORCE_PATH_STYLE === 'true') {
    options.s3ForcePathStyle = true;
  }

  if (AWS_COMPATIBLE_SERVICE_ENDPOINT) {
    options.endpoint = AWS_COMPATIBLE_SERVICE_ENDPOINT;
  }

  // initialize s3
  return new AWS.S3(options);
};

/**
 * Create Google Cloud Storage instance
 */
const createGCS = async () => {
  const GOOGLE_APPLICATION_CREDENTIALS = await getConfig(
    'GOOGLE_APPLICATION_CREDENTIALS'
  );
  const GOOGLE_PROJECT_ID = await getConfig('GOOGLE_PROJECT_ID');
  const BUCKET = await getConfig('GOOGLE_CLOUD_STORAGE_BUCKET');

  if (!GOOGLE_PROJECT_ID || !GOOGLE_APPLICATION_CREDENTIALS || !BUCKET) {
    throw new Error('Google Cloud Storage credentials are not configured');
  }

  const Storage = require('@google-cloud/storage').Storage;

  // initializing Google Cloud Storage
  return new Storage({
    projectId: GOOGLE_PROJECT_ID,
    keyFilename: GOOGLE_APPLICATION_CREDENTIALS
  });
};

/*
 * Save binary data to amazon s3
 */
export const uploadFileAWS = async (
  file: { name: string; path: string; type: string },
  forcePrivate: boolean = false
): Promise<string> => {
  const IS_PUBLIC = forcePrivate
    ? false
    : await getConfig('FILE_SYSTEM_PUBLIC', 'true');
  const AWS_PREFIX = await getConfig('AWS_PREFIX', '');
  const AWS_BUCKET = await getConfig('AWS_BUCKET');

  // initialize s3
  const s3 = await createAWS();

  // generate unique name
  const fileName = `${AWS_PREFIX}${Math.random()}${file.name.replace(
    / /g,
    ''
  )}`;

  // read file
  const buffer = await fs.readFileSync(file.path);

  // upload to s3
  const response: any = await new Promise((resolve, reject) => {
    s3.upload(
      {
        ContentType: file.type,
        Bucket: AWS_BUCKET,
        Key: fileName,
        Body: buffer,
        ACL: IS_PUBLIC === 'true' ? 'public-read' : undefined
      },
      (err, res) => {
        if (err) {
          return reject(err);
        }

        return resolve(res);
      }
    );
  });

  return IS_PUBLIC === 'true' ? response.Location : fileName;
};

/*
 * Delete file from amazon s3
 */
export const deleteFileAWS = async (fileName: string) => {
  const AWS_BUCKET = await getConfig('AWS_BUCKET');

  const params = { Bucket: AWS_BUCKET, Key: fileName };

  // initialize s3
  const s3 = await createAWS();

  return new Promise((resolve, reject) => {
    s3.deleteObject(params, err => {
      if (err) {
        return reject(err);
      }

      return resolve('ok');
    });
  });
};

/*
 * Save file to local disk
 */
export const uploadFileLocal = async (file: {
  name: string;
  path: string;
  type: string;
}): Promise<string> => {
  const oldPath = file.path;

  if (!fs.existsSync(uploadsFolderPath)) {
    fs.mkdirSync(uploadsFolderPath);
  }

  const fileName = `${Math.random()}${file.name.replace(/ /g, '')}`;
  const newPath = `${uploadsFolderPath}/${fileName}`;
  const rawData = fs.readFileSync(oldPath);

  return new Promise((resolve, reject) => {
    fs.writeFile(newPath, rawData, err => {
      if (err) {
        return reject(err);
      }

      return resolve(fileName);
    });
  });
};

/*
 * Save file to google cloud storage
 */
export const uploadFileGCS = async (file: {
  name: string;
  path: string;
  type: string;
}): Promise<string> => {
  const BUCKET = await getConfig('GOOGLE_CLOUD_STORAGE_BUCKET');
  const IS_PUBLIC = await getConfig('FILE_SYSTEM_PUBLIC');

  // initialize GCS
  const storage = await createGCS();

  // select bucket
  const bucket = storage.bucket(BUCKET);

  // generate unique name
  const fileName = `${Math.random()}${file.name}`;

  bucket.file(fileName);

  const response: any = await new Promise((resolve, reject) => {
    bucket.upload(
      file.path,
      {
        metadata: { contentType: file.type },
        public: IS_PUBLIC === 'true'
      },
      (err, res) => {
        if (err) {
          return reject(err);
        }

        if (res) {
          return resolve(res);
        }
      }
    );
  });

  const { metadata, name } = response;

  return IS_PUBLIC === 'true' ? metadata.mediaLink : name;
};

const deleteFileLocal = async (fileName: string) => {
  return new Promise((resolve, reject) => {
    fs.unlink(`${uploadsFolderPath}/${fileName}`, error => {
      if (error) {
        return reject(error);
      }

      return resolve('deleted');
    });
  });
};

const deleteFileGCS = async (fileName: string) => {
  const BUCKET = await getConfig('GOOGLE_CLOUD_STORAGE_BUCKET');

  // initialize GCS
  const storage = await createGCS();

  // select bucket
  const bucket = storage.bucket(BUCKET);

  return new Promise((resolve, reject) => {
    bucket
      .file(fileName)
      .delete()
      .then(err => {
        if (err) {
          return reject(err);
        }

        return resolve('ok');
      });
  });
};

/**
 * Read file from GCS, AWS
 */
export const readFileRequest = async (key: string): Promise<any> => {
  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  if (UPLOAD_SERVICE_TYPE === 'GCS') {
    const GCS_BUCKET = await getConfig('GOOGLE_CLOUD_STORAGE_BUCKET');
    const storage = await createGCS();

    const bucket = storage.bucket(GCS_BUCKET);

    const file = bucket.file(key);

    // get a file buffer
    const [contents] = await file.download({});

    return contents;
  }

  if (UPLOAD_SERVICE_TYPE === 'AWS') {
    const AWS_BUCKET = await getConfig('AWS_BUCKET');
    const s3 = await createAWS();

    return new Promise((resolve, reject) => {
      s3.getObject(
        {
          Bucket: AWS_BUCKET,
          Key: key
        },
        (error, response) => {
          if (error) {
            if (
              error.code === 'NoSuchKey' &&
              error.message.includes('key does not exist')
            ) {
              debugBase(
                `Error occurred when fetching s3 file with key: "${key}"`
              );
            }

            return reject(error);
          }

          return resolve(response.Body);
        }
      );
    });
  }

  if (UPLOAD_SERVICE_TYPE === 'local') {
    return new Promise((resolve, reject) => {
      fs.readFile(`${uploadsFolderPath}/${key}`, (error, response) => {
        if (error) {
          return reject(error);
        }

        return resolve(response);
      });
    });
  }
};

/*
 * Save binary data to amazon s3
 */
export const uploadFile = async (
  apiUrl: string,
  file,
  fromEditor = false
): Promise<any> => {
  const IS_PUBLIC = await getConfig('FILE_SYSTEM_PUBLIC');
  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  let nameOrLink = '';

  if (UPLOAD_SERVICE_TYPE === 'AWS') {
    nameOrLink = await uploadFileAWS(file);
  }

  if (UPLOAD_SERVICE_TYPE === 'GCS') {
    nameOrLink = await uploadFileGCS(file);
  }

  if (UPLOAD_SERVICE_TYPE === 'local') {
    nameOrLink = await uploadFileLocal(file);
  }

  if (fromEditor) {
    const editorResult = { fileName: file.name, uploaded: 1, url: nameOrLink };

    if (IS_PUBLIC !== 'true') {
      editorResult.url = `${apiUrl}/read-file?key=${nameOrLink}`;
    }

    return editorResult;
  }

  return nameOrLink;
};

export const deleteFile = async (fileName: string): Promise<any> => {
  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  if (UPLOAD_SERVICE_TYPE === 'AWS') {
    return deleteFileAWS(fileName);
  }

  if (UPLOAD_SERVICE_TYPE === 'GCS') {
    return deleteFileGCS(fileName);
  }

  if (UPLOAD_SERVICE_TYPE === 'local') {
    return deleteFileLocal(fileName);
  }
};

/**
 * Creates blank workbook
 */
export const createXlsFile = async () => {
  // Generating blank workbook
  const workbook = await xlsxPopulate.fromBlankAsync();

  return { workbook, sheet: workbook.sheet(0) };
};

/**
 * Generates downloadable xls file on the url
 */
export const generateXlsx = async (workbook: any): Promise<string> => {
  return workbook.outputAsync();
};

export const registerOnboardHistory = ({
  type,
  user
}: {
  type: string;
  user: IUserDocument;
}) =>
  OnboardingHistories.getOrCreate({ type, user })
    .then(({ status }) => {
      if (status === 'created') {
        graphqlPubsub.publish('onboardingChanged', {
          onboardingChanged: { userId: user._id, type }
        });
      }
    })
    .catch(e => debugBase(e));

export const authCookieOptions = (secure: boolean) => {
  const oneDay = 1 * 24 * 3600 * 1000; // 1 day

  const cookieOptions = {
    httpOnly: true,
    expires: new Date(Date.now() + oneDay),
    maxAge: oneDay,
    secure
  };

  return cookieOptions;
};

/*
 * Handle engage unsubscribe request
 */
export const handleUnsubscription = async (query: {
  cid: string;
  uid: string;
}) => {
  // const { cid, uid } = query;
  const { uid } = query;

  // if (cid) {
  //   await models.Customers.updateOne(
  //     { _id: cid },
  //     { $set: { isSubscribed: 'No' } }
  //   );
  // }

  if (uid) {
    await Users.updateOne({ _id: uid }, { $set: { isSubscribed: 'No' } });
  }
};

export const getConfigs = async () => {
  const configsCache = await memoryStorage().get('configs_erxes_api');

  if (configsCache && configsCache !== '{}') {
    return JSON.parse(configsCache);
  }

  const configsMap = {};
  const configs = await Configs.find({});

  for (const config of configs) {
    configsMap[config.code] = config.value;
  }

  memoryStorage().set('configs_erxes_api', JSON.stringify(configsMap));

  return configsMap;
};

export const getConfig = async (code, defaultValue?) => {
  const configs = await getConfigs();

  if (!configs[code]) {
    return defaultValue;
  }

  return configs[code];
};

export const resetConfigsCache = () => {
  memoryStorage().set('configs_erxes_api', '');
};

export const frontendEnv = ({
  name,
  req,
  requestInfo
}: {
  name: string;
  req?: any;
  requestInfo?: any;
}): string => {
  const cookies = req ? req.cookies : requestInfo.cookies;
  const keys = Object.keys(cookies);

  const envs: { [key: string]: string } = {};

  for (const key of keys) {
    envs[key.replace('REACT_APP_', '')] = cookies[key];
  }

  return envs[name];
};

export const getSubServiceDomain = ({ name }: { name: string }): string => {
  const MAIN_APP_DOMAIN = getEnv({ name: 'MAIN_APP_DOMAIN' });

  const defaultMappings = {
    API_DOMAIN: `${MAIN_APP_DOMAIN}/api`,
    WIDGETS_DOMAIN: `${MAIN_APP_DOMAIN}/widgets`,
    INTEGRATIONS_API_DOMAIN: `${MAIN_APP_DOMAIN}/integrations`,
    LOGS_API_DOMAIN: `${MAIN_APP_DOMAIN}/logs`,
    ENGAGES_API_DOMAIN: `${MAIN_APP_DOMAIN}/engages`,
    VERIFIER_API_DOMAIN: `${MAIN_APP_DOMAIN}/verifier`,
    AUTOMATIONS_API_DOMAIN: `${MAIN_APP_DOMAIN}/automations`
  };

  const domain = getEnv({ name });

  if (domain) {
    return domain;
  }

  return defaultMappings[name];
};

/**
 * Create s3 stream for excel file
 */
export const s3Stream = async (
  key: string,
  errorCallback: (error: any) => void
): Promise<any> => {
  const AWS_BUCKET = await getConfig('AWS_BUCKET');

  const s3 = await createAWS();

  const stream = s3
    .getObject({ Bucket: AWS_BUCKET, Key: key })
    .createReadStream();

  stream.on('error', errorCallback);

  return stream;
};

export const getCoreDomain = () => {
  const NODE_ENV = process.env.NODE_ENV;

  return NODE_ENV === 'production'
    ? 'https://erxes.io'
    : 'http://localhost:3500';
};

export const routeErrorHandling = (fn, callback?: any) => {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      debugError((e as Error).message);

      if (callback) {
        return callback(res, e, next);
      }

      return next(e);
    }
  };
};

export const isUsingElk = () => {
  const ELK_SYNCER = getEnv({ name: 'ELK_SYNCER', defaultValue: 'true' });

  return ELK_SYNCER === 'false' ? false : true;
};

export const checkPremiumService = async type => {
  try {
    const domain = getEnv({ name: 'MAIN_APP_DOMAIN' })
      .replace('https://', '')
      .replace('http://', '');

    const response = await sendRequest({
      url: `${getCoreDomain()}/check-premium-service?domain=${domain}&type=${type}`,
      method: 'GET'
    });

    return response === 'yes';
  } catch (e) {
    return false;
  }
};

// board item number calculator
export const numberCalculator = (size: number, num?: any, skip?: boolean) => {
  if (num && !skip) {
    num = parseInt(num, 10) + 1;
  }

  if (skip) {
    num = 0;
  }

  num = num.toString();

  while (num.length < size) {
    num = '0' + num;
  }

  return num;
};

export const configReplacer = config => {
  const now = new Date();

  // replace type of date
  return config
    .replace(/\{year}/g, now.getFullYear().toString())
    .replace(/\{month}/g, (now.getMonth() + 1).toString())
    .replace(/\{day}/g, now.getDate().toString());
};

/**
 * Send notification to mobile device from inbox conversations
 * @param {string} - title
 * @param {string} - body
 * @param {string} - customerId
 * @param {array} - receivers
 */
export const sendMobileNotification = async ({
  receivers,
  title,
  body,
  data
}: {
  receivers: string[];
  title: string;
  body: string;
  data?: any;
}): Promise<void> => {
  if (!admin.apps.length) {
    await initFirebase();
  }

  const transporter = admin.messaging();
  const tokens: string[] = [];

  if (receivers) {
    tokens.push(
      ...(await Users.find({ _id: { $in: receivers } }).distinct(
        'deviceTokens'
      ))
    );
  }

  //   if (customerId) {
  //     tokens.push(
  //       ...(await Customers.findOne({ _id: customerId }).distinct(
  //         'deviceTokens'
  //       ))
  //     );
  //   }

  if (tokens.length > 0) {
    // send notification
    for (const token of tokens) {
      try {
        await transporter.send({
          token,
          notification: { title, body },
          data: data || {}
        });
      } catch (e) {
        throw new Error(e);
      }
    }
  }
};

export const getFileUploadConfigs = async () => {
  const AWS_ACCESS_KEY_ID = await getConfig('AWS_ACCESS_KEY_ID');
  const AWS_SECRET_ACCESS_KEY = await getConfig('AWS_SECRET_ACCESS_KEY');
  const AWS_BUCKET = await getConfig('AWS_BUCKET');
  const AWS_COMPATIBLE_SERVICE_ENDPOINT = await getConfig(
    'AWS_COMPATIBLE_SERVICE_ENDPOINT'
  );
  const AWS_FORCE_PATH_STYLE = await getConfig('AWS_FORCE_PATH_STYLE');

  const UPLOAD_SERVICE_TYPE = await getConfig('UPLOAD_SERVICE_TYPE', 'AWS');

  return {
    AWS_FORCE_PATH_STYLE,
    AWS_COMPATIBLE_SERVICE_ENDPOINT,
    AWS_BUCKET,
    AWS_SECRET_ACCESS_KEY,
    AWS_ACCESS_KEY_ID,
    UPLOAD_SERVICE_TYPE
  };
};

export const getEnv = utils.getEnv;
export const paginate = utils.paginate;
export const fixDate = utils.fixDate;
export const getDate = utils.getDate;
export const getToday = utils.getToday;
export const getNextMonth = utils.getNextMonth;
export const cleanHtml = utils.cleanHtml;
export const validSearchText = utils.validSearchText;
export const regexSearchText = utils.regexSearchText;
export const checkUserIds = utils.checkUserIds;
export const chunkArray = utils.chunkArray;
export const splitStr = utils.splitStr;
export const escapeRegExp = utils.escapeRegExp;
export const getUserDetail = utils.getUserDetail;
export const sendRequest = utils.sendRequest;

export default {
  sendEmail,
  readFile,
  createTransporter,
  getImportCsvInfo,
  getCsvHeadersInfo
};
