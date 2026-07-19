declare module 'qrcode-reader' {
  export default class QrCode {
    callback: (
      error: Error | null,
      value?: { result?: string }
    ) => void;
    decode(image: unknown): void;
  }
}
