import pc from "picocolors";

export const isColorSupported =
  Boolean(process.stdout.isTTY) &&
  process.env.NO_COLOR === undefined &&
  process.env.NODE_DISABLE_COLORS === undefined;

export const format = {
  create: (text: string) => (isColorSupported ? pc.green(text) : text),
  update: (text: string) => (isColorSupported ? pc.yellow(text) : text),
  delete: (text: string) => (isColorSupported ? pc.red(text) : text),
  info: (text: string) => (isColorSupported ? pc.cyan(text) : text),
  dim: (text: string) => (isColorSupported ? pc.dim(text) : text),
  bold: (text: string) => (isColorSupported ? pc.bold(text) : text),
  error: (text: string) => (isColorSupported ? pc.red(pc.bold(text)) : text),
  success: (text: string) => (isColorSupported ? pc.green(pc.bold(text)) : text),
};

export const symbols = {
  add: isColorSupported ? pc.green("+") : "+",
  modify: isColorSupported ? pc.yellow("~") : "~",
  remove: isColorSupported ? pc.red("-") : "-",
  destructive: isColorSupported ? pc.red("!") : "!",
  success: isColorSupported ? pc.green("✓") : "[OK]",
  failure: isColorSupported ? pc.red("✗") : "[FAIL]",
  bullet: isColorSupported ? pc.dim("•") : "*",
};
