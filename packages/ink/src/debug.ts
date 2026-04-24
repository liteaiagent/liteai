export const logForDebugging = (message: string, ...args: any[]) => {
  if (process.env.LITEAI_DEBUG_INK) {
    console.debug(`[ink] ${message}`, ...args);
  }
};
