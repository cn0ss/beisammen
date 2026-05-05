// Example Autumn configuration for the Beisammen cloud product.
// Push this from a billing workspace with `atmn push`; it is documentation,
// not part of this repo's TypeScript build.
//
// Beisammen cloud billing is owner-sponsored:
// - the Autumn customer id is the paying Beisammen user id
// - the Autumn entity id is the circle id
// - plan limits are pooled across circles owned by that user
// - member uploads into an owned circle consume the owner's plan

import { feature, item, plan } from 'atmn';

export const mediaUploads = feature({
  id: 'media_uploads',
  name: 'Media uploads',
  type: 'metered',
  consumable: true,
});

export const storageBytes = feature({
  id: 'storage_bytes',
  name: 'Storage bytes',
  type: 'metered',
  consumable: true,
});

export const cloudFamily = plan({
  id: 'cloud_family',
  name: 'Family',
  price: { amount: 9, interval: 'month' },
  items: [
    item({
      featureId: mediaUploads.id,
      included: 250,
      interval: 'month',
      price: {
        amount: 2,
        interval: 'month',
        billingUnits: 100,
        billingMethod: 'usage_based',
      },
    }),
    item({
      featureId: storageBytes.id,
      included: 50_000_000_000,
      interval: 'month',
      price: {
        amount: 1,
        interval: 'month',
        billingUnits: 10_000_000_000,
        billingMethod: 'usage_based',
      },
    }),
  ],
});

export const cloudArchive = plan({
  id: 'cloud_archive',
  name: 'Archive',
  price: { amount: 19, interval: 'month' },
  items: [
    item({
      featureId: mediaUploads.id,
      included: 1_000,
      interval: 'month',
      price: {
        amount: 1,
        interval: 'month',
        billingUnits: 100,
        billingMethod: 'usage_based',
      },
    }),
    item({
      featureId: storageBytes.id,
      included: 250_000_000_000,
      interval: 'month',
      price: {
        amount: 1,
        interval: 'month',
        billingUnits: 25_000_000_000,
        billingMethod: 'usage_based',
      },
    }),
  ],
});
