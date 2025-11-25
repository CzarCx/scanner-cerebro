
'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { supabaseDB2 } from '@/lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XCircle, PackageCheck, AlertTriangle, Trash2, Zap, ZoomIn } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useIsMobile } from '@/hooks/use-mobile';


type DeliveryItem = {
  code: string;
  product: string | null;
  name: string | null;
};

type Encargado = {
  name: string;
};

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [message, setMessage] = useState({text: 'Esperando para escanear...', type: 'info' as 'info' | 'success' | 'error' | 'warning'});
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [encargado, setEncargado] = useState('');
  const [encargadosList, setEncargadosList] = useState<Encargado[]>([]);
  const [deliveryList, setDeliveryList] = useState<DeliveryItem[]>([]);
  const [selectedScannerMode, setSelectedScannerMode] = useState('camara');
  const [scannerActive, setScannerActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notification, setNotification] = useState({ title: '', message: '', variant: 'default' as 'default' | 'destructive' });
  const [cameraCapabilities, setCameraCapabilities] = useState<any>(null);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const isMobile = useIsMobile();


  // Refs
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastScanTimeRef = useRef(Date.now());
  const scannedCodesRef = useRef(new Set<string>());
  const physicalScannerInputRef = useRef<HTMLInputElement | null>(null);
  const bufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const MIN_SCAN_INTERVAL = 1500; // 1.5 seconds

   useEffect(() => {
    const fetchEncargados = async () => {
        const { data, error } = await supabaseDB2
            .from('personal_name')
            .select('name')
            .eq('rol', 'entrega');

        if (error) {
            console.error('Error fetching encargados:', error);
        } else {
            setEncargadosList(data || []);
        }
    };
    fetchEncargados();
  }, []);

  const showAppMessage = (text: string, type: 'success' | 'error' | 'info' | 'warning') => {
    setMessage({text, type});
  };
  
  const showModalNotification = (title: string, message: string, variant: 'default' | 'destructive' = 'default') => {
    setNotification({ title, message, variant });
    setShowNotification(true);
  };


  const onScanSuccess = useCallback(async (decodedText: string) => {
    if (loading || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;

    lastScanTimeRef.current = Date.now();
    setLoading(true);
    showAppMessage('Procesando código...', 'info');
    if ('vibrate' in navigator) navigator.vibrate(100);

    const finalCode = decodedText.trim();

    if (scannedCodesRef.current.has(finalCode)) {
        setLoading(false);
        showAppMessage(`Código ya en la lista: ${finalCode}`, 'warning');
        return;
    }

    try {
        const { data, error } = await supabaseDB2
            .from('personal')
            .select('name, product, status')
            .eq('code', finalCode)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
            throw error;
        }

        if (!data) {
            showModalNotification('Código No Asignado', 'Esta etiqueta aún no ha sido registrada en el sistema.', 'destructive');
        } else if (data.status === 'REPORTADO') {
            showModalNotification('Paquete Reportado', 'Este paquete no está listo para ser enviado, tiene un reporte activo.', 'destructive');
        } else if (data.status === 'CALIFICADO') {
            const newItem: DeliveryItem = {
                code: finalCode,
                product: data.product,
                name: data.name,
            };
            setDeliveryList(prev => [newItem, ...prev]);
            scannedCodesRef.current.add(finalCode);
            showAppMessage(`Paquete listo: ${finalCode}`, 'success');
        } else {
             showModalNotification('Paquete no Calificado', `Este paquete aún no ha sido calificado (Estado: ${data.status}).`);
        }

    } catch (e: any) {
        showModalNotification('Error de Base de Datos', `Hubo un problema al consultar el código: ${e.message}`, 'destructive');
    } finally {
        setLoading(false);
    }
  }, [loading]);

  const processPhysicalScan = (code: string) => {
      onScanSuccess(code);
  };

  const handlePhysicalScannerInput = (event: KeyboardEvent) => {
      if(event.key === 'Enter') {
          event.preventDefault();
          if(bufferRef.current.length > 0) {
              processPhysicalScan(bufferRef.current);
              bufferRef.current = '';
          }
          return;
      }

      if(event.key.length === 1) {
          bufferRef.current += event.key;
          if(scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = setTimeout(() => {
              if(bufferRef.current.length > 0) {
                  processPhysicalScan(bufferRef.current);
                  bufferRef.current = '';
              }
          }, 150);
      }
  };

  useEffect(() => {
    setIsMounted(true);
    const input = physicalScannerInputRef.current;
    
    if (selectedScannerMode === 'fisico' && scannerActive && input) {
      input.addEventListener('keydown', handlePhysicalScannerInput);
      input.focus();
    }
    
    return () => {
      if (input) {
        input.removeEventListener('keydown', handlePhysicalScannerInput);
      }
    };
  }, [scannerActive, selectedScannerMode]);

  const applyCameraConstraints = useCallback((track: MediaStreamTrack) => {
    track.applyConstraints({
      advanced: [{
        zoom: zoom,
        torch: isFlashOn
      }]
    }).catch(e => console.error("Failed to apply constraints", e));
  }, [zoom, isFlashOn]);
  
  useEffect(() => {
    if (isMobile && scannerActive && selectedScannerMode === 'camara' && html5QrCodeRef.current?.isScanning) {
      const videoElement = document.getElementById('reader')?.querySelector('video');
      if (videoElement && videoElement.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          applyCameraConstraints(track);
        }
      }
    }
  }, [zoom, isFlashOn, scannerActive, selectedScannerMode, isMobile, applyCameraConstraints]);

  useEffect(() => {
    if (!isMounted || !readerRef.current) return;

    const cleanup = () => {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        return html5QrCodeRef.current.stop().catch(err => {
          if (!String(err).includes('not started')) {
            console.error("Fallo al detener el escáner:", err);
          }
        });
      }
      return Promise.resolve();
    };

    if (scannerActive && selectedScannerMode === 'camara') {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(readerRef.current.id, false);
      }
      
      if (html5QrCodeRef.current && !html5QrCodeRef.current.isScanning) {
        const config = {
          fps: 5,
          qrbox: { width: 250, height: 250 },
        };
        html5QrCodeRef.current.start({ facingMode: "environment" }, config, onScanSuccess, (e: any) => {}).then(() => {
            if (isMobile) {
              const videoElement = document.getElementById('reader')?.querySelector('video');
              if(videoElement && videoElement.srcObject) {
                  const stream = videoElement.srcObject as MediaStream;
                  const track = stream.getVideoTracks()[0];
                  if (track) {
                      const capabilities = track.getCapabilities();
                      setCameraCapabilities(capabilities);
                      if (capabilities.zoom) {
                        setZoom(capabilities.zoom.min || 1);
                      }
                  }
              }
            }
        }).catch(err => {
            console.error("Error al iniciar camara:", err);
            showAppMessage('Error al iniciar la cámara. Revisa los permisos.', 'error');
            setScannerActive(false);
        });
      }
    } else {
      cleanup().then(() => {
        if(isMobile) {
            setCameraCapabilities(null);
            setIsFlashOn(false);
            setZoom(1);
        }
      });
    }

    return () => {
      cleanup();
    };
  }, [scannerActive, selectedScannerMode, onScanSuccess, isMounted, isMobile]);

  const startScanner = () => {
    if (!encargado.trim()) return showAppMessage('Por favor, selecciona un encargado.', 'error');
    setScannerActive(true);
    if(selectedScannerMode === 'camara') {
      showAppMessage('Cámara activada. Apunta al código.', 'info');
    } else {
      physicalScannerInputRef.current?.focus();
      showAppMessage('Escáner físico activo. Escanea códigos.', 'info');
    }
  };

  const stopScanner = () => {
    if(scannerActive) {
      setScannerActive(false);
      showAppMessage('Escaneo detenido.', 'info');
       if (selectedScannerMode === 'fisico' && physicalScannerInputRef.current) {
        physicalScannerInputRef.current.blur();
      }
    }
  };

  const removeFromList = (codeToRemove: string) => {
    setDeliveryList(prev => prev.filter(item => item.code !== codeToRemove));
    scannedCodesRef.current.delete(codeToRemove);
    showAppMessage(`Código ${codeToRemove} eliminado de la lista.`, 'info');
  };

  const handleUpdateStatusToDelivered = async () => {
    if (deliveryList.length === 0) {
      showModalNotification('Lista Vacía', 'No hay paquetes en la lista para marcar como entregados.');
      return;
    }
    setLoading(true);
    showAppMessage('Actualizando estados...', 'info');

    const codesToUpdate = deliveryList.map(item => item.code);
    const deliveryTimestamp = new Date().toISOString();

    try {
      const { error } = await supabaseDB2
        .from('personal')
        .update({ status: 'ENTREGADO', date_entre: deliveryTimestamp })
        .in('code', codesToUpdate);
      
      if (error) throw error;
      
      showModalNotification('Éxito', `Se marcaron ${deliveryList.length} paquetes como "ENTREGADO".`);
      setDeliveryList([]);
      scannedCodesRef.current.clear();
      showAppMessage('Esperando para escanear...', 'info');

    } catch (e: any) {
      showModalNotification('Error al Actualizar', `No se pudieron actualizar los registros: ${e.message}`, 'destructive');
    } finally {
      setLoading(false);
    }
  };

  const messageClasses: any = {
      success: 'bg-green-100 border-green-400 text-green-800',
      error: 'bg-red-100 border-red-400 text-red-800',
      warning: 'bg-yellow-100 border-yellow-400 text-yellow-800',
      info: 'bg-blue-100 border-blue-400 text-blue-800'
  };

  return (
    <>
        <Head>
            <title>Entrega de Paquetes</title>
        </Head>

        <main className="text-starbucks-dark flex items-center justify-center p-4">
            <div className="w-full max-w-md mx-auto bg-starbucks-white rounded-xl shadow-2xl p-4 md:p-6 space-y-4">
                <header className="text-center">
                    <h1 className="text-xl md:text-2xl font-bold text-starbucks-green">Módulo de Entrega</h1>
                    <p className="text-gray-600 text-sm mt-1">Escanea los paquetes para confirmar su entrega.</p>
                </header>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="encargado" className="block text-sm font-bold text-starbucks-dark mb-1">Nombre del Encargado:</label>
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
                    
                    <div>
                        <label className="block text-sm font-bold text-starbucks-dark mb-1">Método de Escaneo:</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setSelectedScannerMode('camara')} className={`area-btn w-full px-4 py-3 text-sm rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'camara' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>CÁMARA</button>
                            <button onClick={() => setSelectedScannerMode('fisico')} className={`area-btn w-full px-4 py-3 text-sm rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'fisico' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>ESCÁNER FÍSICO</button>
                        </div>
                    </div>
                </div>

                <div className="bg-starbucks-cream p-4 rounded-lg">
                    <div className="scanner-container relative">
                        <div id="reader" ref={readerRef} style={{ display: selectedScannerMode === 'camara' && scannerActive ? 'block' : 'none' }}></div>
                         {scannerActive && selectedScannerMode === 'camara' && <div id="laser-line"></div>}
                         <input type="text" id="physical-scanner-input" ref={physicalScannerInputRef} className="hidden-input" autoComplete="off" />
                         {selectedScannerMode === 'camara' && !scannerActive && (
                             <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
                                <p className="text-gray-500">La cámara está desactivada.</p>
                            </div>
                         )}
                    </div>
                    
                     {isMobile && scannerActive && selectedScannerMode === 'camara' && cameraCapabilities && (
                        <div id="camera-controls" className="flex items-center gap-4 mt-4 p-2 rounded-lg bg-gray-200">
                            {cameraCapabilities.torch && (
                                <Button variant="ghost" size="icon" onClick={() => setIsFlashOn(prev => !prev)} className={isFlashOn ? 'bg-yellow-400' : ''}>
                                    <Zap className="h-5 w-5" />
                                </Button>
                            )}
                            {cameraCapabilities.zoom && (
                                <div className="flex-1 flex items-center gap-2">
                                    <ZoomIn className="h-5 w-5" />
                                    <input
                                        id="zoom-slider"
                                        type="range"
                                        min={cameraCapabilities.zoom.min}
                                        max={cameraCapabilities.zoom.max}
                                        step={cameraCapabilities.zoom.step}
                                        value={zoom}
                                        onChange={(e) => setZoom(parseFloat(e.target.value))}
                                        className="w-full"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
                        <Button onClick={startScanner} disabled={scannerActive || loading || !encargado} className="bg-blue-600 hover:bg-blue-700 text-sm">Iniciar</Button>
                        <Button onClick={stopScanner} disabled={!scannerActive} variant="destructive" className="text-sm">Detener</Button>
                    </div>

                    <div id="physical-scanner-status" className="mt-4 text-center p-2 rounded-md bg-starbucks-accent text-white text-sm" style={{ display: scannerActive && selectedScannerMode === 'fisico' ? 'block' : 'none' }}>
                        Escáner físico listo.
                    </div>
                </div>

                <div id="result-container" className="space-y-4">
                     <div id="message" className={`p-3 rounded-lg text-center font-medium text-base transition-all duration-300 ${messageClasses[message.type]}`}>
                        {message.text}
                    </div>
                </div>
                
                <div>
                     <div className="flex flex-col sm:flex-row justify-between items-center mb-2 gap-2">
                        <h2 className="text-lg font-bold text-starbucks-dark">Para Entrega ({deliveryList.length})</h2>
                        <Button onClick={handleUpdateStatusToDelivered} disabled={loading || deliveryList.length === 0} className="bg-green-600 hover:bg-green-700 w-full sm:w-auto">
                           <PackageCheck className="mr-2 h-4 w-4" /> Entregar
                        </Button>
                    </div>

                    <div className="table-container border border-gray-200 rounded-lg max-h-60 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-starbucks-cream">
                                <TableRow>
                                    <TableHead>Código</TableHead>
                                    <TableHead>Empaquetado por</TableHead>
                                    <TableHead className="text-right">Acción</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {deliveryList.length > 0 ? deliveryList.map((item) => (
                                    <TableRow key={item.code}>
                                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                                        <TableCell className="text-xs">{item.name || 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => removeFromList(item.code)} className="text-red-500 hover:text-red-700 h-8 w-8">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center text-gray-500 py-8">
                                            No hay paquetes en la lista.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>

            {loading && <div id="loading-overlay" style={{display: 'flex'}}>
                <div className="overlay-spinner"></div>
                <p className="text-lg font-semibold">Procesando...</p>
            </div>}
            
            {showNotification && (
                <div id="qr-confirmation-overlay" className="p-4" style={{display: 'flex'}}>
                     <div className="bg-starbucks-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center space-y-4">
                        <Alert variant={notification.variant as any}>
                            {notification.variant === 'destructive' ? <XCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                            <AlertTitle>{notification.title}</AlertTitle>
                            <AlertDescription>{notification.message}</AlertDescription>
                        </Alert>
                        <div className="flex justify-center gap-4 mt-4">
                           <Button onClick={() => setShowNotification(false)}>Cerrar</Button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    </>
  );
}

    