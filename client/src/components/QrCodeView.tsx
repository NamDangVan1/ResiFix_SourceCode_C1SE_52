import React, { useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
// @ts-ignore
import { toQR } from 'toqr';

export interface QrCodeViewProps {
  value: string;
  size?: number;
  quietZone?: number;
  color?: string;
  backgroundColor?: string;
  style?: any;
}

/**
 * Component hiển thị mã QR chuẩn đen-trắng 100% bằng React Native View (pixel-grid)
 * Hoạt động độc lập, không phụ thuộc thư viện native hay kết nối internet.
 */
export const QrCodeView: React.FC<QrCodeViewProps> = ({
  value,
  size = 120,
  quietZone = 2,
  color = '#000000',
  backgroundColor = '#FFFFFF',
  style,
}) => {
  const { matrix, gridCount } = useMemo(() => {
    try {
      if (!value) return { matrix: [], gridCount: 0 };
      const raw = toQR(value);
      const dimension = Math.round(Math.sqrt(raw.length));
      const rows: boolean[][] = [];
      for (let r = 0; r < dimension; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < dimension; c++) {
          row.push(raw[r * dimension + c] === 1);
        }
        rows.push(row);
      }
      return { matrix: rows, gridCount: dimension };
    } catch (err) {
      console.warn('Lỗi khi sinh ma trận QR:', err);
      return { matrix: [], gridCount: 0 };
    }
  }, [value]);

  if (!matrix.length) {
    return (
      <View style={[styles.fallbackBox, { width: size, height: size }, style]}>
        <View style={styles.fallbackDot} />
      </View>
    );
  }

  const totalCells = gridCount + quietZone * 2;
  const cellSize = size / totalCells;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          backgroundColor,
          padding: quietZone * cellSize,
        },
        style,
      ]}
    >
      {matrix.map((row, rIdx) => (
        <View key={`r-${rIdx}`} style={{ flexDirection: 'row', height: cellSize }}>
          {row.map((isBlack, cIdx) => (
            <View
              key={`c-${cIdx}`}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: isBlack ? color : backgroundColor,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

/**
 * Xuất chuỗi SVG vector sắc nét từ dữ liệu QR code
 */
export function generateQrSvg(value: string, quietZone: number = 2): string {
  try {
    const raw = toQR(value);
    const size = Math.round(Math.sqrt(raw.length));
    const total = size + quietZone * 2;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (raw[r * size + c] === 1) {
          path += `M${c + quietZone},${r + quietZone}h1v1h-1z `;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="100%" height="100%" shape-rendering="crispEdges">
  <rect width="${total}" height="${total}" fill="#FFFFFF"/>
  <path d="${path.trim()}" fill="#000000"/>
</svg>`;
  } catch {
    return '';
  }
}

/**
 * In mã QR căn hộ dạng thẻ tem dán chính thức
 */
export function printQrCode(roomCode: string, locationStr: string, buildingAddress: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  const svg = generateQrSvg(`ROOM:${roomCode}`, 3);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mã QR - Căn hộ ${roomCode}</title>
  <style>
    @page { size: auto; margin: 10mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
    }
    .print-card {
      background: #ffffff;
      border: 2px dashed #0284c7;
      border-radius: 16px;
      padding: 28px 32px;
      text-align: center;
      max-width: 380px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 800;
      font-size: 18px;
      color: #0284c7;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .room-title {
      font-size: 32px;
      font-weight: 900;
      color: #0f172a;
      margin: 6px 0;
      letter-spacing: 0.5px;
    }
    .location-text {
      font-size: 14px;
      color: #475569;
      margin: 4px 0 16px 0;
      line-height: 1.4;
    }
    .qr-container {
      width: 220px;
      height: 220px;
      margin: 0 auto 14px auto;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
    }
    .code-badge {
      display: inline-block;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 6px 14px;
      border-radius: 999px;
      font-family: monospace;
      font-weight: 700;
      font-size: 15px;
      color: #334155;
      margin-bottom: 12px;
    }
    .instruction {
      font-size: 13px;
      color: #64748b;
      line-height: 1.4;
      margin: 0;
    }
    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
      font-size: 11px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="print-card">
    <div class="brand">🏢 RESIFIX SMART BUILDING</div>
    <div class="room-title">CĂN HỘ ${roomCode}</div>
    <div class="location-text">${locationStr}<br><strong>${buildingAddress}</strong></div>
    <div class="qr-container">${svg}</div>
    <div class="code-badge">ROOM:${roomCode}</div>
    <p class="instruction">Mở ứng dụng <strong>ResiFix</strong> &gt; Chọn <strong>Quét mã QR</strong><br>để tự động nhận diện phòng và báo cáo sự cố.</p>
    <div class="footer">Mã QR chính thức thuộc sở hữu căn hộ • BQL Tòa nhà BMB</div>
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 350);
    };
  </script>
</body>
</html>
  `);
  printWindow.document.close();
}

/**
 * Tải file vector SVG của mã QR về máy tính
 */
export function downloadQrSvg(roomCode: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  const svg = generateQrSvg(`ROOM:${roomCode}`, 2);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `QR_RESIFIX_ROOM_${roomCode}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallbackBox: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
  },
  fallbackDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#94A3B8',
  },
});

