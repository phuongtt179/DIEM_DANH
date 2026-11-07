const ORG_NAME = 'Lập trình sáng tạo BNP';
const ISSUER_NAME = 'Thầy Phương';

export interface ReceiptData {
  studentName: string;
  className: string;
  month: string; // yyyy-MM
  amount: number;
  paidDate: string; // yyyy-MM-dd
  note: string | null;
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readGroup(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(`${DIGITS[h]} trăm`);
  if (t === 0) {
    if (u > 0 && parts.length > 0) parts.push('lẻ');
  } else if (t === 1) {
    parts.push('mười');
  } else {
    parts.push(`${DIGITS[t]} mươi`);
  }
  if (u > 0) {
    if (u === 1 && t >= 2) parts.push('mốt');
    else if (u === 5 && t >= 1) parts.push('lăm');
    else parts.push(DIGITS[u]);
  }
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  let rest = Math.round(Math.abs(amount));
  if (rest === 0) return 'Không đồng';

  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups: number[] = [];
  while (rest > 0 && groups.length < 3) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  if (rest > 0) groups.push(rest);

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const text = groups[i] >= 1000 ? String(groups[i]) : readGroup(groups[i], i < groups.length - 1);
    parts.push(units[i] ? `${text} ${units[i]}` : text);
  }
  const words = parts.join(' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} đồng`;
}

export function receiptFileName(data: ReceiptData): string {
  const slug = data.studentName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Bien-lai-${slug}-${data.month}.png`;
}

const WIDTH = 720;
const PADDING = 48;
const LABEL_WIDTH = 170;
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const FONT = 'Arial, "Segoe UI", Roboto, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawReceipt(data: ReceiptData): HTMLCanvasElement {
  const [year, month] = data.month.split('-');
  const [paidYear, paidMonth, paidDay] = data.paidDate.split('-');
  const contentWidth = WIDTH - PADDING * 2;
  const valueWidth = contentWidth - LABEL_WIDTH;
  const rowFont = `600 20px ${FONT}`;

  const measure = document.createElement('canvas').getContext('2d')!;
  const rows: { label: string; lines: string[] }[] = [
    ['Học sinh', data.studentName],
    ['Lớp', data.className],
    ['Số buổi học', '8 buổi/tháng'],
    ...(data.note ? [['Ghi chú', data.note]] : []),
  ].map(([label, value]) => {
    measure.font = rowFont;
    return { label, lines: wrap(measure, value, valueWidth) };
  });

  measure.font = `italic 18px ${FONT}`;
  const wordLines = wrap(measure, `Bằng chữ: ${amountInWords(data.amount)}`, contentWidth - 40);
  measure.font = `700 22px ${FONT}`;
  const orgLines = wrap(measure, ORG_NAME, contentWidth);
  measure.font = `italic 18px ${FONT}`;
  const thanksLines = [
    ...wrap(measure, `TT BNP lập trình sáng tạo đã nhận học phí tháng ${month}/${year}`, contentWidth),
    ...wrap(measure, `của em ${data.studentName}. Cảm ơn phụ huynh.`, contentWidth),
  ];

  const height =
    PADDING +
    orgLines.length * 30 + 16 +
    92 +
    rows.reduce((sum, row) => sum + row.lines.length * 28 + 14, 0) +
    16 + 74 + wordLines.length * 26 + 24 +
    112 + 28 + thanksLines.length * 26 + PADDING;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, WIDTH - 28, height - 28);
  ctx.textBaseline = 'alphabetic';

  let y = PADDING + 10;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 22px ${FONT}`;
  for (const line of orgLines) {
    ctx.fillText(line, WIDTH / 2, y + 12);
    y += 30;
  }
  y += 16;

  ctx.font = `700 32px ${FONT}`;
  ctx.fillText('BIÊN LAI THU HỌC PHÍ', WIDTH / 2, y + 26);
  ctx.fillStyle = MUTED;
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`Học phí tháng ${month}/${year}`, WIDTH / 2, y + 58);
  y += 92;

  ctx.textAlign = 'left';
  for (const row of rows) {
    ctx.fillStyle = MUTED;
    ctx.font = `20px ${FONT}`;
    ctx.fillText(row.label, PADDING, y + 20);
    ctx.fillStyle = INK;
    ctx.font = rowFont;
    row.lines.forEach((line, i) => ctx.fillText(line, PADDING + LABEL_WIDTH, y + 20 + i * 28));
    y += row.lines.length * 28 + 14;
  }
  y += 16;

  const boxHeight = 74 + wordLines.length * 26 + 8;
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(PADDING, y, contentWidth, boxHeight);
  ctx.fillStyle = MUTED;
  ctx.font = `20px ${FONT}`;
  ctx.fillText('Số tiền đã thu', PADDING + 20, y + 44);
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(`${Math.round(data.amount).toLocaleString('vi-VN')} đ`, WIDTH - PADDING - 20, y + 46);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `italic 18px ${FONT}`;
  wordLines.forEach((line, i) => ctx.fillText(line, PADDING + 20, y + 82 + i * 26));
  y += boxHeight + 16;

  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = `italic 18px ${FONT}`;
  ctx.fillText(`Ngày ${paidDay} tháng ${paidMonth} năm ${paidYear}`, WIDTH - PADDING, y + 30);
  ctx.fillStyle = MUTED;
  ctx.font = `18px ${FONT}`;
  ctx.fillText('Người lập biên lai', WIDTH - PADDING, y + 60);
  ctx.fillStyle = INK;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(ISSUER_NAME, WIDTH - PADDING, y + 90);
  y += 112;

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(WIDTH - PADDING, y);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `italic 18px ${FONT}`;
  thanksLines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, y + 34 + i * 26));

  return canvas;
}
