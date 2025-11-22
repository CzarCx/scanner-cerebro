
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Trash2 } from 'lucide-react';


type ScanResult = {
    name: string | null;
    product: string | null;
    code: string;
    found: boolean;
    error?: string;
    status?: string | null;
    details?: string | null;
};

type ReportReason = {
    id: number;
    t_report: string;
};

type Encargado = {
  name: string;
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
  const [selectedScannerMode, setSelectedScannerMode] = useState('camara');
  const [encargado, setEncargado] = useState('');
  const [encargadosList, setEncargadosList] = useState<Encargado[]>([]);
  const [scanMode, setScanMode] = useState('individual');
  const [massScannedCodes, setMassScannedCodes] = useState<ScanResult[]>([]);


  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastScanTimeRef = useRef(Date.now());
  const MIN_SCAN_INTERVAL = 2000; // 2 seconds between scans
  const massScannedCodesRef = useRef(new Set<string>());

   useEffect(() => {
    const fetchEncargados = async () => {
        const { data, error } = await supabaseDB2
            .from('personal_name')
            .select('name')
            .eq('rol', 'barra');

        if (error) {
            console.error('Error fetching encargados:', error);
        } else {
            setEncargadosList(data || []);
        }
    };
    fetchEncargados();
  }, []);

  const onScanSuccess = useCallback(async (decodedText: string) => {
    if (loading || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    
    lastScanTimeRef.current = Date.now();
    setLoading(true);
    setMessage('Procesando código...');
    if ('vibrate' in navigator) navigator.vibrate(100);

    // Prevent duplicates in mass scanning mode
    if (scanMode === 'masivo' && massScannedCodesRef.current.has(decodedText)) {
        setMessage(`Código duplicado: ${decodedText}`);
        setLoading(false);
        return;
    }
    

    try {
        const { data, error } = await supabaseDB2
            .from('personal')
            .select('name, product, status, details')
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
                status: data.status,
                details: data.details,
            };

            if (data.status === 'CALIFICADO') {
                setMessage(`Etiqueta ya procesada (Estado: ${data.status}).`);
                setLastScannedResult(result);
            } else {
                 if (scanMode === 'individual') {
                    setLastScannedResult(result);
                    setMessage('Etiqueta confirmada correctamente.');
                    setIsRatingModalOpen(true);
                } else { // Mass scanning mode
                    if (data.status === 'REPORTADO') {
                       setMessage(`Añadido a la lista (previamente reportado): ${decodedText}`);
                    } else {
                       setMessage(`Añadido a la lista: ${decodedText}`);
                    }
                    setMassScannedCodes(prev => [result, ...prev]);
                    massScannedCodesRef.current.add(decodedText);
                }
            }
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
  }, [loading, scanMode]);

  useEffect(() => {
    if (!readerRef.current) return;

    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(readerRef.current.id, false);
    }
    const qrCode = html5QrCodeRef.current;

    const cleanup = () => {
        if (qrCode && qrCode.getState() === Html5QrcodeScannerState.SCANNING) {
            return qrCode.stop().catch(err => {
                if (!String(err).includes('not started')) {
                    console.error("Fallo al detener el escáner:", err);
                }
            });
        }
        return Promise.resolve();
    };

    if (scannerActive && selectedScannerMode === 'camara') {
        if (qrCode.getState() !== Html5QrcodeScannerState.SCANNING) {
            const config = {
                fps: 5,
                qrbox: { width: 250, height: 250 },
            };
            qrCode.start({ facingMode: "environment" }, config, onScanSuccess, (e: any) => {}).catch(err => {
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
  }, [scannerActive, selectedScannerMode, onScanSuccess]);


  useEffect(() => {
      // Clear list when switching modes
      setMassScannedCodes([]);
      massScannedCodesRef.current.clear();
      setLastScannedResult(null);
  }, [scanMode]);

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
              .update({ status: 'CALIFICADO', details: null })
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

  const handleMassQualify = async () => {
    if (massScannedCodes.length === 0) {
        alert("No hay códigos en la lista para calificar.");
        return;
    }
    setLoading(true);
    try {
        const codesToUpdate = massScannedCodes.map(item => item.code);
        const qualificationTimestamp = new Date().toISOString();

        const { error } = await supabaseDB2
            .from('personal')
            .update({ status: 'CALIFICADO', details: null, data_cal: qualificationTimestamp })
            .in('code', codesToUpdate);

        if (error) {
            throw error;
        }

        alert(`Se calificaron ${massScannedCodes.length} etiquetas correctamente.`);
        setMassScannedCodes([]); // Clear the list
        massScannedCodesRef.current.clear();

    } catch (e: any) {
        console.error('Error en la calificación masiva:', e);
        alert(`Error al calificar masivamente: ${e.message}`);
    } finally {
        setLoading(false);
    }
};

  const removeFromMassList = (codeToRemove: string) => {
    setMassScannedCodes(prev => prev.filter(item => item.code !== codeToRemove));
    massScannedCodesRef.current.delete(codeToRemove);
    setMessage(`Código ${codeToRemove} eliminado de la lista.`);
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
        <div className="w-full max-w-lg mx-auto bg-starbucks-white rounded-xl shadow-2xl p-6 space-y-6">
          <header className="text-center">
            <h1 className="text-2xl font-bold text-starbucks-green">Confirmación de Etiquetado</h1>
            <p className="text-gray-600 mt-1">Escanea el código QR de la etiqueta para ver los detalles.</p>
          </header>

          <div className="space-y-2">
              <label htmlFor="encargado" className="block text-sm font-bold text-starbucks-dark mb-2">Nombre del Encargado:</label>
               <Select onValueChange={setEncargado} value={encargado} disabled={scannerActive}>
                  <SelectTrigger className="form-input">
                      <SelectValue placeholder="Selecciona un encargado" />
                  </SelectTrigger>
                  <SelectContent>
                      {encargadosList.map((enc) => (
                          <SelectItem key={enc.name} value={enc.name}>
                              {enc.name}
                          </SelectItem>
                      ))}
                  </SelectContent>
              </Select>
          </div>

          <div className="space-y-2">
              <label className="block text-sm font-bold text-starbucks-dark mb-2">Método de Escaneo:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button onClick={() => setSelectedScannerMode('camara')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'camara' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>CÁMARA</button>
                  <button onClick={() => setSelectedScannerMode('fisico')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'fisico' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>ESCÁNER FÍSICO</button>
              </div>
          </div>
          
          <div className="space-y-2">
              <label className="block text-sm font-bold text-starbucks-dark mb-2">Tipo de Escaneo:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button onClick={() => setScanMode('individual')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${scanMode === 'individual' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>Escaneo Individual</button>
                  <button onClick={() => setScanMode('masivo')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${scanMode === 'masivo' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>Escaneo Masivo</button>
              </div>
          </div>

          <div className="bg-starbucks-cream p-4 rounded-lg">
            <div className="scanner-container relative">
                <div id="reader" ref={readerRef} style={{ display: selectedScannerMode === 'camara' && scannerActive ? 'block' : 'none' }}></div>
                {scannerActive && selectedScannerMode === 'camara' && <div id="laser-line"></div>}
                {selectedScannerMode === 'camara' && !scannerActive && (
                    <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
                        <p className="text-gray-500">La cámara está desactivada.</p>
                    </div>
                )}
            </div>
             {loading && (
                <div className="flex justify-center items-center mt-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-starbucks-green"></div>
                    <p className="ml-3">Buscando...</p>
                </div>
             )}
            <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
              <button onClick={() => { setScannerActive(true); setLastScannedResult(null); setMessage('Apunte la cámara a un código QR.'); }} disabled={scannerActive || loading || !encargado} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400">
                Iniciar Escaneo
              </button>
              <button onClick={() => setScannerActive(false)} disabled={!scannerActive || loading} className="px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 bg-red-600 hover:bg-red-700 disabled:bg-gray-400">
                Detener Escaneo
              </button>
            </div>
             <div id="physical-scanner-status" className="mt-4 text-center p-2 rounded-md bg-starbucks-accent text-white" style={{ display: scannerActive && selectedScannerMode === 'fisico' ? 'block' : 'none' }}>
                Escáner físico listo. Conecta tu dispositivo y comienza a escanear.
            </div>
          </div>

          <div id="result-container" className="space-y-4">
            <div className={`p-4 rounded-lg text-center font-semibold text-lg transition-all duration-300 ${!lastScannedResult && massScannedCodes.length === 0 ? 'bg-gray-100 text-gray-800' : lastScannedResult?.found ? 'bg-green-100 border-green-400 text-green-700' : 'bg-yellow-100 border-yellow-400 text-yellow-700'}`}>
              {message}
            </div>

            {/* Individual Scan Result */}
            {lastScannedResult && scanMode === 'individual' && (
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
                        {lastScannedResult.status === 'CALIFICADO' ? (
                             <div className="text-center font-semibold text-orange-600 bg-orange-100 border border-orange-300 p-3 rounded-md">
                                Esta etiqueta ya fue procesada. Estado: {lastScannedResult.status}
                            </div>
                        ) : (
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
                                {lastScannedResult.status === 'REPORTADO' && (
                                    <Alert variant="destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertTitle>Atención: Reporte Previo</AlertTitle>
                                        <AlertDescription>
                                            Este producto fue reportado por: <span className="font-semibold">{lastScannedResult.details || 'Motivo no especificado'}</span>.
                                        </AlertDescription>
                                    </Alert>
                                )}
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
                                        <Button size="lg" variant="destructive" onClick={handleSendReport} disabled={loading || !selectedReport}>
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
                        )}
                    </>
                ) : (
                  lastScannedResult.error ? (
                    <p className="text-red-600">Error: {lastScannedResult.error}</p>
                  ) : null
                )}
              </div>
            )}
             {/* Mass Scan Results */}
             {scanMode === 'masivo' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-starbucks-dark">Códigos Escaneados ({massScannedCodes.length})</h2>
                        <Button onClick={handleMassQualify} disabled={loading || massScannedCodes.length === 0} className="bg-green-600 hover:bg-green-700">
                            {loading ? 'Calificando...' : 'Calificar Todos'}
                        </Button>
                    </div>
                    <div className="table-container border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-starbucks-cream">
                                <TableRow>
                                    <TableHead>Código</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>Empaquetado por</TableHead>
                                    <TableHead className="text-right">Acción</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {massScannedCodes.length > 0 ? massScannedCodes.map((item) => (
                                    <TableRow key={item.code}>
                                        <TableCell className="font-mono">{item.code}</TableCell>
                                        <TableCell>{item.product || 'N/A'}</TableCell>
                                        <TableCell>{item.name || 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => removeFromMassList(item.code)} className="text-red-500 hover:text-red-700">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                     <TableRow>
                                        <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                                            No hay códigos en la lista.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
