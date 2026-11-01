'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Printer, Share2, X } from 'lucide-react';
import { drawReceipt, receiptFileName, ReceiptData } from '@/lib/receipt';

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export default function ReceiptModal({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);

  useEffect(() => {
    setCanCopy(typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write);
    const probe = new File([''], 'probe.png', { type: 'image/png' });
    setCanShare(!!navigator.canShare?.({ files: [probe] }));
  }, []);

  const canvas = useMemo(() => drawReceipt(data), [data]);
  const imageUrl = useMemo(() => canvas.toDataURL('image/png'), [canvas]);
  const fileName = receiptFileName(data);

  async function share() {
    const blob = await toBlob(canvas);
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setMessage('Không chia sẻ được, hãy tải ảnh về rồi gửi.');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(canvas) })]);
      setMessage('Đã sao chép ảnh, dán (Ctrl+V) vào Zalo để gửi.');
    } catch {
      setMessage('Không sao chép được, hãy tải ảnh về rồi gửi.');
    }
  }

  async function download() {
    const url = URL.createObjectURL(await toBlob(canvas));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const buttonClass = 'flex items-center justify-center gap-2 px-3 py-2 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold text-sm';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <style>{`
        @media print {
          @page { margin: 10mm; }
          body * { visibility: hidden; }
          #receipt-print-image {
            visibility: visible;
            position: fixed;
            top: 0;
            left: 0;
            width: 148mm;
            max-width: 100%;
            border: 0;
          }
        }
      `}</style>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-800">Biên lai học phí</h2>
          <button onClick={onClose} aria-label="Đóng" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            id="receipt-print-image"
            src={imageUrl}
            alt={`Biên lai học phí của ${data.studentName}`}
            className="w-full border border-gray-200 rounded-lg"
          />

          {message && <p role="status" className="text-sm text-blue-700">{message}</p>}

          <div className="grid grid-cols-2 gap-2">
            {canShare && (
              <button type="button" onClick={share} className={buttonClass}>
                <Share2 size={16} /> Chia sẻ
              </button>
            )}
            {canCopy && (
              <button type="button" onClick={copy} className={buttonClass}>
                <Copy size={16} /> Sao chép ảnh
              </button>
            )}
            <button type="button" onClick={download} className={buttonClass}>
              <Download size={16} /> Tải ảnh
            </button>
            <button type="button" onClick={() => window.print()} className={buttonClass}>
              <Printer size={16} /> In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
