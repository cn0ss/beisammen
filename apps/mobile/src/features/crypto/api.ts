import { makeFunctionReference } from 'convex/server';

export interface UserKeyRecord {
  keyVersion: number;
  publicKey: string;
  encPrivateKey: string;
  encMasterKeyByRecovery: string;
  encRecoveryKeyByMaster: string;
  createdAt: number;
  updatedAt: number;
}

export interface CircleKeyGrantRecord {
  epoch: number;
  sealedCircleKey: string;
  grantedBy: string;
  createdAt: number;
}

export interface MyCircleKeys {
  currentEpoch: number | null;
  grants: CircleKeyGrantRecord[];
}

export interface MemberPublicKey {
  userId: string;
  publicKey: string | null;
}

export interface MissingKeyGrants {
  currentEpoch: number | null;
  missing: MemberPublicKey[];
}

export const keysApi = {
  getMyKeys: makeFunctionReference<'query', Record<string, never>, UserKeyRecord | null>(
    'keys:getMyKeys',
  ),
  registerKeys: makeFunctionReference<
    'mutation',
    {
      keyVersion: number;
      publicKey: string;
      encPrivateKey: string;
      encMasterKeyByRecovery: string;
      encRecoveryKeyByMaster: string;
    },
    { created: boolean }
  >('keys:registerKeys'),
  getCircleMemberPublicKeys: makeFunctionReference<
    'query',
    { circleId: string },
    MemberPublicKey[]
  >('keys:getCircleMemberPublicKeys'),
  getMyCircleKeys: makeFunctionReference<'query', { circleId: string }, MyCircleKeys>(
    'keys:getMyCircleKeys',
  ),
  initializeCircleKey: makeFunctionReference<
    'mutation',
    { circleId: string; sealedCircleKey: string },
    { epoch: number; created: boolean }
  >('keys:initializeCircleKey'),
  grantCircleKeys: makeFunctionReference<
    'mutation',
    {
      circleId: string;
      epoch: number;
      grants: Array<{ userId: string; sealedCircleKey: string }>;
    },
    { granted: number }
  >('keys:grantCircleKeys'),
  rotateCircleKey: makeFunctionReference<
    'mutation',
    {
      circleId: string;
      grants: Array<{ userId: string; sealedCircleKey: string }>;
    },
    { epoch: number }
  >('keys:rotateCircleKey'),
  listMissingKeyGrants: makeFunctionReference<
    'query',
    { circleId: string },
    MissingKeyGrants
  >('keys:listMissingKeyGrants'),
};
