export type CircleRole = 'owner' | 'admin' | 'member';

export function canManageCircle(role: CircleRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwnerRole(role: CircleRole): boolean {
  return role === 'owner';
}

export function canPublish(role: CircleRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}
