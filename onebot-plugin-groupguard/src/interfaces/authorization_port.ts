export interface IAuthorizationPort {
  isOwner(userId: string): boolean;
  isAdminOrOwner(groupId: string, userId: string): Promise<boolean>;
}
