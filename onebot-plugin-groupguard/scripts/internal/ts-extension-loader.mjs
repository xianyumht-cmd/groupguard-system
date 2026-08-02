export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw error;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;

    for (const extension of ['.ts', '.tsx', '.js', '.mjs']) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        // Try the next extension.
      }
    }

    throw error;
  }
}
