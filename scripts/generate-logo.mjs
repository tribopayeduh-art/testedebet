import sharp from 'sharp';
import fs from 'fs';

const svgLogo = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 240" width="1000" height="240">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@1,900&amp;display=swap');
      .logo-text {
        font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-weight: 900;
        font-style: italic;
        font-size: 148px;
        letter-spacing: -6px;
        fill: #ffffff;
      }
      .spade-shape {
        fill: #ffffff;
      }
      .spade-cut {
        fill: #09090d;
      }
    </style>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>

  <g filter="url(#shadow)">
    <!-- Spade Icon embedded in P/L/A area -->
    <g transform="translate(245, 60) scale(0.65) skewX(-12)">
      <!-- Spade Body -->
      <path d="M 50 15 C 30 -20 -30 20 0 70 C 20 100 50 130 50 130 C 50 130 80 100 100 70 C 130 20 70 -20 50 15 Z" fill="#ffffff"/>
      <!-- Spade Stem -->
      <path d="M 42 110 L 58 110 L 68 150 L 32 150 Z" fill="#ffffff"/>
      <!-- Inner Spade Cutout -->
      <circle cx="50" cy="65" r="16" fill="#09090d"/>
    </g>

    <!-- Main Text "playzada" -->
    <text x="35" y="172" class="logo-text">playzada</text>
  </g>
</svg>
`;

async function generate() {
  fs.writeFileSync('public/brand/playzada-logo.svg', svgLogo);
  
  const pngBuffer = await sharp(Buffer.from(svgLogo))
    .resize(1000, 240)
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('public/brand/playzada-logo.png', pngBuffer);
  fs.writeFileSync('public/brand/amora-bet-logo.png', pngBuffer); // for seamless fallback
  console.log('Logo generated successfully!');
}

generate().catch(console.error);
