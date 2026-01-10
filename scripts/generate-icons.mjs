import sharp from 'sharp';
import { readFileSync } from 'fs';

const svgBuffer = readFileSync('./public/icons/icon.svg');

// Generate 192x192 icon
await sharp(svgBuffer)
  .resize(192, 192)
  .png()
  .toFile('./public/icons/icon-192x192.png');

console.log('✓ Generated icon-192x192.png');

// Generate 512x512 icon
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile('./public/icons/icon-512x512.png');

console.log('✓ Generated icon-512x512.png');

console.log('✓ All icons generated successfully!');
