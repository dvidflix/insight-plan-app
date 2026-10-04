import { useCustomFieldsSync } from '../viewer/customFields';

/** Keeps the SeaTable custom fields on the model elements (see viewer/customFields.ts). Renders nothing. */
export function CustomFieldsSync() {
  useCustomFieldsSync();
  return null;
}
