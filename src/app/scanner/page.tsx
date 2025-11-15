'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

export default function ScannerPage() {
  const [message, setMessage] = useState('Apunte la cámara a un código QR.');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastScanTimeRef = useRef(Date.now());
  const MIN_SCAN_INTERVAL = 1000; // 1 second between scans

  const onScanSuccess = useCallback((decodedText: string) => {
    if (Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    lastScanTimeRef.current = Date.now();

    setLastScanned(decodedText);
    setMessage(`Código escaneado: ${decodedText}`);
    
    if ('vibrate' in navigator) navigator.vibrate(200);

    // Stop scanner after successful scan
    setScannerActive(false);

  }, []);

  useEffect(() => {
    if (!readerRef.current) return;

    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(readerRef.current.id, false);
    }
    const qrCode = html5QrCodeRef.current;

    const cleanup = () => {
        if (qrCode && qrCode.getState() === Html5QrcodeScannerState.SCANNING) {
            return qrCode.stop().catch(err => {
                if (String(err).includes('transition')) return;
                console.error("Fallo al detener el escáner en la limpieza:", err);
            });
        }
        return Promise.resolve();
    };

    if (scannerActive) {
        if (qrCode.getState() !== Html5QrcodeScannerState.SCANNING) {
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                videoConstraints: {
                    facingMode: "environment"
                }
            };
            qrCode.start({ facingMode: "environment" }, config, onScanSuccess, (e: any) => {}).catch(err => {
                if (String(err).includes('transition')) return;
                console.error("Error al iniciar camara:", err);
                setMessage('Error al iniciar la cámara. Revisa los permisos.');
                setScannerActive(false);
            });
        }
    } else {
        cleanup();
    }

    return () => {
      cleanup();
    };
  }, [scannerActive, onScanSuccess]);


  return (
    <>
      <Head>
        <title>Lector QR</title>
      </Head>
      <main className="bg-starbucks-light-gray text-starbucks-dark min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto bg-starbucks-white rounded-xl shadow-2xl p-6 space-y-6">
          <header className="text-center">
            <h1 className="text-2xl font-bold text-starbucks-green">Lector de QR</h1>
            <p className="text-gray-600 mt-1">Página de escaneo rápido.</p>
          </header>

          <div className="bg-starbucks-cream p-4 rounded-lg">
            <div className="scanner-container">
              <div id="reader" ref={readerRef}></div>
            </div>

            <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
              <button onClick={() => setScannerActive(true)} disabled={scannerActive} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400">
                Iniciar Escaneo
              </button>
              <button onClick={() => setScannerActive(false)} disabled={!scannerActive} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-red-600 hover:bg-red-700 disabled:bg-gray-400">
                Detener Escaneo
              </button>
            </div>
          </div>

          <div id="result-container" className="space-y-4">
            <div className="p-4 rounded-lg text-center font-semibold text-lg bg-blue-100 border border-blue-400 text-blue-700">
              {message}
            </div>
            {lastScanned && (
              <div className="bg-starbucks-cream p-3 rounded-lg text-center">
                <h3 className="font-bold text-starbucks-dark uppercase text-sm">Último Código</h3>
                <p className="text-xl font-mono text-starbucks-green break-words">{lastScanned}</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
