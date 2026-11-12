// Le immagini importate dall'interfaccia (Vite le dà come indirizzo).
declare module "*.svg" {
  const url: string;
  export default url;
}
