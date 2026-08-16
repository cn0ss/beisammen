import { feature, item, plan } from 'atmn';

// Beisammen cloud billing is owner-sponsored:
// - Autumn customer id: paying Beisammen user id
// - Autumn entity id: circle id
// - plan limits are pooled across circles owned by that user
// - member uploads into an owned circle consume the owner's plan

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
  consumable: false,
});

export const cloudFamily = plan({
  id: 'cloud_family',
  name: 'Family',
  group: 'beisammen_cloud',
  price: { amount: 9, interval: 'month' },
  items: [
    item({
      featureId: mediaUploads.id,
      included: 250,
      price: {
        amount: 2,
        interval: 'month',
        billingMethod: 'usage_based',
        billingUnits: 100,
      },
    }),
    item({
      featureId: storageBytes.id,
      included: 50_000_000_000,
      price: {
        amount: 1,
        interval: 'month',
        billingMethod: 'usage_based',
        billingUnits: 10_000_000_000,
      },
    }),
  ],
});

export const cloudArchive = plan({
  id: 'cloud_archive',
  name: 'Archive',
  group: 'beisammen_cloud',
  price: { amount: 19, interval: 'month' },
  items: [
    item({
      featureId: mediaUploads.id,
      included: 1_000,
      price: {
        amount: 1,
        interval: 'month',
        billingMethod: 'usage_based',
        billingUnits: 100,
      },
    }),
    item({
      featureId: storageBytes.id,
      included: 250_000_000_000,
      price: {
        amount: 1,
        interval: 'month',
        billingMethod: 'usage_based',
        billingUnits: 25_000_000_000,
      },
    }),
  ],
});
