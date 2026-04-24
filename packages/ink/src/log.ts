export const logError = (err: Error | string, ...args: any[]) => {
  console.error(`[ink error]`, err, ...args);
};
