declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export const sheet: string;
  export default classes;
}
