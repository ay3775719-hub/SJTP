export const galleryOrderingAlignmentMigration = {
  version: 13,
  name: '013_gallery_ordering_alignment',
  sql: `
    UPDATE settings
    SET value = json_set(value, '$.galleryView', 'grid'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE key = 'ui.preferences' AND json_valid(value);
  `
} as const
