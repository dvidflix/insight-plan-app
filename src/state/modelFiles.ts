/** The IFC files loaded in Inputs this session, by model name — kept so
    Scenarios can put a model into the project folder without asking for the
    file again. Not persisted: after a reload the file is asked for. */
const files = new Map<string, File>();

/** Reads a model's IFC from the project's model store when it isn't at hand (the model came from the store as a .frag). */
export async function ensureModelFile(name: string, root: string | null): Promise<File | null> {
  const have = files.get(name);
  if (have || !root) return have ?? null;
  try {
    const { getStoredIfc } = await import('../db/modelsApi');
    const file = new File([await getStoredIfc(root, name)], name);
    files.set(name, file);
    return file;
  } catch {
    return null;
  }
}

export const rememberModelFile = (file: File) => files.set(file.name, file);

/** Hash of the stored IFC of models opened from the model store without their file (what identifies their content). */
const storedHashes = new Map<string, string>();
export const rememberStoredHash = (name: string, hash: string) => storedHashes.set(name, hash);
export const storedHashOf = (name: string) => storedHashes.get(name) ?? null;
export const modelFileFor = (stem: string): File | null => files.get(`${stem}.ifc`) ?? [...files.values()].find((f) => f.name.replace(/\.ifc$/i, '') === stem) ?? null;
export const modelFileByName = (name: string): File | null => files.get(name) ?? null;

/** Sizes of the files dropped on Inputs (by file name), remembered across reloads
    so the Inputs table can show them. */
const SIZES_KEY = 'inputs.fileSizes';
const readSizes = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};
export const rememberFileSize = (file: File) => {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify({ ...readSizes(), [file.name]: file.size }));
  } catch {
    // not remembered
  }
};
export const fileSizeOf = (name: string | null | undefined): number | null => (name ? readSizes()[name] ?? null : null);
