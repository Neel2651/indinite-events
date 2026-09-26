import { generateQrKeyPair } from "../src/qr";

const { privateKeyHex, publicKeyHex } = generateQrKeyPair();
console.log("# Add to .env.local (keep the private key secret, never commit it)");
console.log(`QR_SIGNING_PRIVATE_KEY=${privateKeyHex}`);
console.log(`NEXT_PUBLIC_QR_PUBLIC_KEY=${publicKeyHex}`);
