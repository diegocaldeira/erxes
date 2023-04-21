import * as dotenv from 'dotenv';
dotenv.config();

import { ErxesProxyTarget } from 'src/proxy/targets';
import { supergraphConfigPath, supergraphPath } from './paths';
import * as fs from 'fs';
import { execSync } from 'child_process';
import isSameFile from '../util/is-same-file';
import * as yaml from 'yaml';

const { NODE_ENV, SUPERGRAPH_POLL_INTERVAL_MS } = process.env;

type SupergraphConfig = {
  federation_version: string;
  subgraphs: {
    [name: string]: {
      routing_url: string;
      schema: {
        subgraph_url: string;
      };
    };
  };
};

const createSupergraphConfig = (proxyTargets: ErxesProxyTarget[]) => {
  const superGraphConfigNext = supergraphConfigPath + '.next';
  const config: SupergraphConfig = {
    federation_version: '=2.3.1',
    subgraphs: {}
  };

  for (const { name, address } of proxyTargets) {
    const endpoint = `${address}/graphql`;
    config.subgraphs[name] = {
      routing_url: endpoint,
      schema: {
        subgraph_url: endpoint
      }
    };
  }
  fs.writeFileSync(superGraphConfigNext, yaml.stringify(config), {
    encoding: 'utf-8'
  });

  if (
    !fs.existsSync(supergraphConfigPath) ||
    !isSameFile(supergraphConfigPath, superGraphConfigNext)
  ) {
    execSync(`cp ${superGraphConfigNext}  ${supergraphConfigPath}`);
  }
};

const supergraphComposeOnce = async () => {
  if (NODE_ENV === 'production') {
    // Don't rewrite supergraph schema if it exists. Delete and restart to update the supergraph.graphql
    if (fs.existsSync(supergraphPath)) {
      return;
    }

    execSync(
      `rover supergraph compose --config ${supergraphConfigPath} --output ${supergraphPath} --elv2-license=accept --log=debug`,
      {
        stdio: 'inherit',
        encoding: 'utf-8'
      }
    );

    // Running execSync('rover') causes the container to exit with code 137. Exiting early.
    process.exit(1);
  } else {
    const superGraphqlNext = supergraphPath + '.next';

    execSync(
      `yarn rover supergraph compose --config ${supergraphConfigPath} --output ${superGraphqlNext} --elv2-license=accept`,
      {
        stdio: 'inherit'
      }
    );

    if (
      !fs.existsSync(supergraphPath) ||
      !isSameFile(supergraphPath, superGraphqlNext)
    ) {
      execSync(`cp ${superGraphqlNext} ${supergraphPath}`);
      console.log(`NEW Supergraph Schema was printed to ${supergraphPath}`);
    }
  }
};

export default async function supergraphCompose(
  proxyTargets: ErxesProxyTarget[]
) {
  await createSupergraphConfig(proxyTargets);
  await supergraphComposeOnce();
  if (NODE_ENV === 'development') {
    setInterval(async () => {
      try {
        await supergraphComposeOnce();
      } catch (e) {
        console.error(e.message);
      }
    }, Number(SUPERGRAPH_POLL_INTERVAL_MS) || 10_000);
  }
}