
'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { supabaseDB2 } from '@/lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XCircle, PackageCheck, AlertTriangle, Trash2 } from 'lucide-react';


type DeliveryItem = {
  code: string;
  product: string | null;
  name: string | null;
};

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [message, setMessage] = useState({text: 'Esperando para escanear...', type: 'info' as 'info' | 'success' | 'error' | 'warning'});
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [encargado, setEncargado] = useState('');
  const [deliveryList, setDeliveryList] = useState<DeliveryItem[]>([]);
  const [selectedScannerMode, setSelectedScannerMode] = useState('camara');
  const [scannerActive, setScannerActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notification, setNotification] = useState({ title: '', message: '', variant: 'default' as 'default' | 'destructive' });

  // Refs
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const lastScanTimeRef = useRef(Date.now());
  const scannedCodesRef = useRef(new Set<string>());
  const physicalScannerInputRef = useRef<HTMLInputElement | null>(null);
  const bufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const MIN_SCAN_INTERVAL = 1500; // 1.5 seconds

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
            showAppMessage(`Paquete listo para entrega: ${finalCode}`, 'success');
        } else {
             showModalNotification('Estado Incorrecto', `El paquete tiene estado "${data.status}" y no puede ser entregado aún.`);
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


  useEffect(() => {
    if (!isMounted || !readerRef.current) return;

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
                showAppMessage('Error al iniciar la cámara. Revisa los permisos.', 'error');
                setScannerActive(false);
            });
        }
    } else {
        cleanup();
    }

    return () => {
      cleanup();
    };
  }, [scannerActive, selectedScannerMode, onScanSuccess, isMounted]);

  const startScanner = () => {
    if (!encargado.trim()) return showAppMessage('Por favor, ingresa el nombre del encargado.', 'error');
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

    try {
      const { error } = await supabaseDB2
        .from('personal')
        .update({ status: 'ENTREGADO' })
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

        <main className="bg-starbucks-light-gray text-starbucks-dark min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-4xl mx-auto bg-starbucks-white rounded-xl shadow-2xl p-6 md:p-8 space-y-6">
                <header className="text-center">
                    <Image src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnQ4MGZzdXYzYWo1cXRiM3I1cjNoNjd4cjdia202ZXcwNjJ6YjdvbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QQO6BH98nhigF8FLsb/giphy.gif" alt="Scanner Logo" width={96} height={96} className="mx-auto h-24 w-auto mb-4" />
                    <h1 className="text-2xl md:text-3xl font-bold text-starbucks-green">Módulo de Entrega</h1>
                    <p className="text-gray-600 mt-1">Escanea los paquetes para confirmar su entrega.</p>
                </header>

                <div className="space-y-2">
                    <label htmlFor="encargado" className="block text-sm font-bold text-starbucks-dark mb-2">Nombre del Encargado:</label>
                    <input type="text" id="encargado" name="encargado" className="form-input" placeholder="Ej: Juan Pérez" value={encargado} onChange={(e) => setEncargado(e.target.value)} disabled={scannerActive} />
                </div>
                
                <div className="space-y-2">
                    <label className="block text-sm font-bold text-starbucks-dark mb-2">Método de Escaneo:</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button onClick={() => setSelectedScannerMode('camara')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'camara' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>CÁMARA</button>
                        <button onClick={() => setSelectedScannerMode('fisico')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedScannerMode === 'fisico' ? 'scanner-mode-selected' : ''}`} disabled={scannerActive}>ESCÁNER FÍSICO</button>
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
                    
                    <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
                        <Button onClick={startScanner} disabled={scannerActive || loading} className="bg-blue-600 hover:bg-blue-700">Iniciar Escaneo</Button>
                        <Button onClick={stopScanner} disabled={!scannerActive} variant="destructive">Detener Escaneo</Button>
                    </div>

                    <div id="physical-scanner-status" className="mt-4 text-center p-2 rounded-md bg-starbucks-accent text-white" style={{ display: scannerActive && selectedScannerMode === 'fisico' ? 'block' : 'none' }}>
                        Escáner físico listo. Comienza a escanear.
                    </div>
                </div>

                <div id="result-container" className="space-y-4">
                     <div id="message" className={`p-3 rounded-lg text-center font-medium text-md transition-all duration-300 ${messageClasses[message.type]}`}>
                        {message.text}
                    </div>
                </div>
                
                <div>
                     <div className="flex justify-between items-center mb-2">
                        <h2 className="text-xl font-bold text-starbucks-dark">Paquetes para Entrega ({deliveryList.length})</h2>
                        <Button onClick={handleUpdateStatusToDelivered} disabled={loading || deliveryList.length === 0} className="bg-green-600 hover:bg-green-700">
                           <PackageCheck className="mr-2 h-4 w-4" /> Marcar como Entregados
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
                                {deliveryList.length > 0 ? deliveryList.map((item) => (
                                    <TableRow key={item.code}>
                                        <TableCell className="font-mono">{item.code}</TableCell>
                                        <TableCell>{item.product || 'N/A'}</TableCell>
                                        <TableCell>{item.name || 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => removeFromList(item.code)} className="text-red-500 hover:text-red-700">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                                            No hay paquetes en la lista de entrega.
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
                <p className="text-xl font-semibold">Procesando...</p>
            </div>}
            
            {showNotification && (
                <div id="qr-confirmation-overlay" className="p-4" style={{display: 'flex'}}>
                     <div className="bg-starbucks-white rounded-lg shadow-xl p-6 w-full max-w-md text-center space-y-4">
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
    