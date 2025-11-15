
'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { supabaseDB2 } from '@/lib/supabaseClient';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"


type ScanResult = {
    name: string | null;
    product: string | null;
    code: string;
    found: boolean;
    error?: string;
};

type ReportReason = {
    id: number;
    t_report: string;
};

export default function ScannerPage() {
  const [message, setMessage] = useState('Apunte la cámara a un código QR.');
  const [lastScannedResult, setLastScannedResult] = useState<ScanResult | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [reportReasons, setReportReasons] = useState<ReportReason[]>([]);
  const [selectedReport, setSelectedReport] = useState('');
  const [showReportSelect, setShowReportSelect] = useState(false);


  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastScanTimeRef = useRef(Date.now());
  const MIN_SCAN_INTERVAL = 2000; // 2 seconds between scans

  const onScanSuccess = useCallback(async (decodedText: string) => {
    if (loading || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    
    lastScanTimeRef.current = Date.now();
    setLoading(true);
    setMessage('Procesando código...');
    if ('vibrate' in navigator) navigator.vibrate(200);

    try {
        const { data, error } = await supabaseDB2
            .from('personal')
            .select('name, product')
            .eq('code', decodedText)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
            throw error;
        }

        if (data) {
            const result: ScanResult = {
                name: data.name,
                product: data.product,
                code: decodedText,
                found: true,
            };
            setLastScannedResult(result);
            setMessage('Etiqueta confirmada correctamente.');
        } else {
            const result: ScanResult = {
                name: null,
                product: null,
                code: decodedText,
                found: false,
            };
            setLastScannedResult(result);
            setMessage('Esta etiqueta todavía no ha sido asignada.');
        }
    } catch (e: any) {
        const result: ScanResult = {
            name: null,
            product: null,
            code: decodedText,
            found: false,
            error: e.message,
        };
        setLastScannedResult(result);
        setMessage(`Error al consultar la base de datos: ${e.message}`);
    } finally {
        setLoading(false);
    }
  }, [loading]);

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

  const handleOpenRatingModal = (isOpen: boolean) => {
    setIsRatingModalOpen(isOpen);
    if (!isOpen) {
        // Reset state when modal closes
        setShowReportSelect(false);
        setSelectedReport('');
        setLastScannedResult(null);
        setMessage('Apunte la cámara a un código QR.');
    }
  }

  const handleSendReport = async () => {
    if (!selectedReport || !lastScannedResult?.code) {
        alert("Por favor, selecciona un motivo de reporte.");
        return;
    }
    setLoading(true);
    try {
        const { error } = await supabaseDB2
            .from('personal')
            .update({ details: selectedReport, status: 'REPORTADO' })
            .eq('code', lastScannedResult.code);

        if (error) {
            throw error;
        }

        alert('Reporte enviado correctamente.');
        handleOpenRatingModal(false); // Close and reset

    } catch (e: any) {
        console.error('Error enviando el reporte:', e);
        alert(`Error al enviar el reporte: ${e.message}`);
    } finally {
        setLoading(false);
    }
  };

  const handleAccept = async () => {
      if (!lastScannedResult?.code) return;
      setLoading(true);
      try {
          const { error } = await supabaseDB2
              .from('personal')
              .update({ status: 'CALIFICADO' })
              .eq('code', lastScannedResult.code);

          if (error) {
              throw error;
          }

          alert('Calificación guardada correctamente.');
          handleOpenRatingModal(false); // Cierra y resetea
      } catch (e: any) {
          console.error('Error guardando la calificación:', e);
          alert(`Error al guardar la calificación: ${e.message}`);
      } finally {
          setLoading(false);
      }
  };


  useEffect(() => {
    if (isRatingModalOpen && showReportSelect && reportReasons.length === 0) {
        const fetchReportReasons = async () => {
            const { data, error } = await supabaseDB2
                .from('reports')
                .select('id, t_report');
            
            if (error) {
                console.error('Error fetching report reasons:', error);
            } else {
                setReportReasons(data || []);
            }
        };

        fetchReportReasons();
    }
  }, [isRatingModalOpen, showReportSelect, reportReasons.length]);


  return (
    <>
      <Head>
        <title>Confirmación de Etiquetado</title>
      </Head>
      <main className="bg-starbucks-light-gray text-starbucks-dark min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto bg-starbucks-white rounded-xl shadow-2xl p-6 space-y-6">
          <header className="text-center">
            <h1 className="text-2xl font-bold text-starbucks-green">Confirmación de Etiquetado</h1>
            <p className="text-gray-600 mt-1">Escanea el código QR de la etiqueta para ver los detalles.</p>
          </header>

          <div className="bg-starbucks-cream p-4 rounded-lg">
            <div className="scanner-container">
              <div id="reader" ref={readerRef}></div>
            </div>
             {loading && (
                <div className="flex justify-center items-center mt-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-starbucks-green"></div>
                    <p className="ml-3">Buscando...</p>
                </div>
             )}
            <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
              <button onClick={() => { setScannerActive(true); setLastScannedResult(null); setMessage('Apunte la cámara a un código QR.'); }} disabled={scannerActive || loading} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400">
                Iniciar Escaneo
              </button>
              <button onClick={() => setScannerActive(false)} disabled={!scannerActive || loading} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-red-600 hover:bg-red-700 disabled:bg-gray-400">
                Detener Escaneo
              </button>
            </div>
          </div>

          <div id="result-container" className="space-y-4">
            <div className={`p-4 rounded-lg text-center font-semibold text-lg ${!lastScannedResult ? 'bg-gray-100' : lastScannedResult.found ? 'bg-green-100 border-green-400 text-green-700' : 'bg-yellow-100 border-yellow-400 text-yellow-700'}`}>
              {message}
            </div>
            {lastScannedResult && (
              <div className="bg-starbucks-cream p-4 rounded-lg text-left space-y-2">
                <div>
                    <h3 className="font-bold text-starbucks-dark uppercase text-sm">Código</h3>
                    <p className="text-lg font-mono text-starbucks-green break-words">{lastScannedResult.code}</p>
                </div>
                {lastScannedResult.found ? (
                    <>
                        <div>
                            <h3 className="font-bold text-starbucks-dark uppercase text-sm">Empaquetado por</h3>
                            <p className="text-lg text-gray-800">{lastScannedResult.name || 'No especificado'}</p>
                        </div>
                        <div>
                            <h3 className="font-bold text-starbucks-dark uppercase text-sm">Producto</h3>
                            <p className="text-lg text-gray-800">{lastScannedResult.product || 'No especificado'}</p>
                        </div>
                        <Dialog open={isRatingModalOpen} onOpenChange={handleOpenRatingModal}>
                          <DialogTrigger asChild>
                            <Button className="w-full mt-4 bg-starbucks-accent hover:bg-starbucks-green text-white">
                              Calificar Empaquetado
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle>Calificar Empaquetado</DialogTitle>
                              <DialogDescription>
                                ¿Cómo calificarías la calidad del empaquetado de este producto?
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                               {showReportSelect && (
                                   <Select onValueChange={setSelectedReport} value={selectedReport}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Selecciona un motivo de reporte" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                        <SelectLabel>Motivos de Reporte</SelectLabel>
                                        {reportReasons.map((reason) => (
                                            <SelectItem key={reason.id} value={reason.t_report}>
                                            {reason.t_report}
                                            </SelectItem>
                                        ))}
                                        </SelectGroup>
                                    </SelectContent>
                                    </Select>
                               )}
                            </div>
                            <DialogFooter className="sm:justify-center">
                                {showReportSelect ? (
                                    <Button size="lg" variant="destructive" onClick={handleSendReport} disabled={loading}>
                                        {loading ? 'Enviando...' : 'Enviar Reporte'}
                                    </Button>
                                ) : (
                                  <>
                                    <Button size="lg" variant="destructive" onClick={() => setShowReportSelect(true)}>
                                        Reportar
                                    </Button>
                                    <Button size="lg" onClick={handleAccept} className="bg-green-600 hover:bg-green-700">
                                      {loading ? 'Guardando...' : 'Aceptar'}
                                    </Button>
                                  </>
                                )}
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                    </>
                ) : (
                  lastScannedResult.error ? (
                    <p className="text-red-600">Error: {lastScannedResult.error}</p>
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
