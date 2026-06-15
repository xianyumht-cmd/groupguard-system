export type AuthCommand =
  | {
      channel: 'private';
      action: 'grant';
      actorUserId: string;
      originalText: string;
      targetGroupId: string;
      durationToken: string;
    }
  | {
      channel: 'private';
      action: 'revoke';
      actorUserId: string;
      originalText: string;
      targetGroupId: string;
    }
  | {
      channel: 'private';
      action: 'query_private';
      actorUserId: string;
      originalText: string;
      targetGroupId: string;
    }
  | {
      channel: 'group';
      action: 'query_group';
      actorUserId: string;
      originalText: string;
      groupId: string;
    }
  | {
      channel: 'group';
      action: 'activate';
      actorUserId: string;
      originalText: string;
      groupId: string;
      activationKey: string;
    };
