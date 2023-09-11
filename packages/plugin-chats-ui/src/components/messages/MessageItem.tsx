import React, { useRef } from 'react';
import { convertFromHTML } from 'draft-js';
import dayjs from 'dayjs';
import calendar from 'dayjs/plugin/calendar';
// erxes
import Avatar from '@erxes/ui/src/components/nameCard/Avatar';
import Attachment from '@erxes/ui/src/components/Attachment';
import Tip from '@erxes/ui/src/components/Tip';
import Icon from '@erxes/ui/src/components/Icon';
import withCurrentUser from '@erxes/ui/src/auth/containers/withCurrentUser';
import { IUser } from '@erxes/ui/src/auth/types';
import {
  MessageItemWrapper,
  MessageWrapper,
  MessageReply,
  MessageBody,
  MessageOption,
  MessageContent,
  MessageAttachmentWrapper,
  MessageBy
} from '../../styles';
import ChatForward from '../../containers/chats/ChatForward';

dayjs.extend(calendar);

type Props = {
  message: any;
  setReply: (text: string) => void;
  isWidget?: boolean;
  chatType?: string;
};

type FinalProps = {
  currentUser: IUser;
} & Props;

const MessageItem = (props: FinalProps) => {
  const { message, currentUser, isWidget, chatType } = props;

  const isMe = currentUser._id === message.createdUser._id;
  const draftContent =
    message.relatedMessage && convertFromHTML(message.relatedMessage.content);

  const renderAttachments = () => {
    return (message.attachments || []).map(attachment => (
      <Attachment
        key={attachment._id}
        attachment={attachment || {}}
        simple={true}
      />
    ));
  };

  const userInfo =
    message.relatedMessage.createdUser &&
    (message.relatedMessage.createdUser.details.fullName ||
      message.relatedMessage.createdUser.email);

  const renderReplyText = () => {
    if (isMe) {
      return (
        <>
          You replied to{' '}
          {message.relatedMessage.createdUser._id === currentUser._id
            ? 'yourself'
            : userInfo}
        </>
      );
    }

    return (
      <>
        {(message.createdUser.details.fullName || message.createdUser.email) +
          'replied to '}
        {message.relatedMessage.createdUser._id === message.createdUser._id
          ? 'themself'
          : userInfo}
      </>
    );
  };

  return (
    <MessageItemWrapper me={isMe}>
      <div style={{ flex: 1 }} />
      <MessageWrapper me={isMe}>
        {draftContent && (
          <MessageReply me={isMe}>
            <b>
              <Icon icon="reply" /> {renderReplyText()}
            </b>
            <p>{draftContent.contentBlocks[0].text}</p>
          </MessageReply>
        )}
        {chatType === 'group' && !isMe && !draftContent && (
          <MessageBy>
            {message.createdUser &&
              (message.createdUser.details.fullName ||
                message.createdUser.email)}
          </MessageBy>
        )}
        {message.content !== '<p></p>' && (
          <MessageBody me={isMe}>
            <ChatForward
              content={message.content}
              attachments={message.attachments}
              currentUser={currentUser}
            />
            <Tip placement="top" text="Reply">
              <MessageOption onClick={() => props.setReply(message)}>
                <Icon icon="reply" color="#9d9d9d" />
              </MessageOption>
            </Tip>
            <Tip
              placement="top"
              text={message.createdAt && dayjs(message.createdAt).calendar()}
            >
              <MessageContent
                dangerouslySetInnerHTML={{ __html: message.content || '' }}
                me={isMe}
              />
            </Tip>
          </MessageBody>
        )}
        <MessageAttachmentWrapper isWidget={isWidget}>
          {renderAttachments()}
        </MessageAttachmentWrapper>
      </MessageWrapper>
      {!isMe && <Avatar user={message.createdUser} size={36} showTip={true} />}
    </MessageItemWrapper>
  );
};

const WithCurrentUser = withCurrentUser(MessageItem);

export default (props: Props) => {
  return <WithCurrentUser {...props} />;
};
