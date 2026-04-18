const workosClientId = process.env.WORKOS_CLIENT_ID;

if (!workosClientId) {
  throw new Error('WORKOS_CLIENT_ID must be set on the Convex deployment.');
}

export default {
  providers: [
    {
      type: 'customJwt' as const,
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256' as const,
      jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
      applicationID: workosClientId,
    },
    {
      type: 'customJwt' as const,
      issuer: `https://api.workos.com/user_management/${workosClientId}`,
      algorithm: 'RS256' as const,
      jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
    },
  ],
};
