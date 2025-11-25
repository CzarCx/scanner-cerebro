
'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '@/lib/supabaseClient';
import { supabaseDB2 } from '@/lib/supabaseClient';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from '@/components/ui/button';
import { Zap, ZoomIn } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';


type ScannedItem = {
  code: string;
  fecha: string;
  hora: string;
  encargado: string;
  area: string;
  sku: string | null;
  cantidad: number | null;
  producto: string | null;
  empresa: string | null;
  venta: string | null;
};

type PersonalScanItem = {
  code: string;
  sku: string | null;
  personal: string;
  encargado: string;
  product: string | null;
  quantity: number | null;
  organization: string | null;
  venta: string | null;
  date: string;
};

type Encargado = {
  name: string;
};


// Helper function to check if a string is likely a name
const isLikelyName = (text: string): boolean => {
  const trimmed = text.trim();
  // Not a number, has spaces, and more than 5 chars.
  return isNaN(Number(trimmed)) && trimmed.includes(' ') && trimmed.length > 5;
};


export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [message, setMessage] = useState({text: 'Esperando para escanear...', type: 'info' as 'info' | 'success' | 'duplicate'});
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [encargado, setEncargado] = useState('');
  const [encargadosList, setEncargadosList] = useState<Encargado[]>([]);
  const [scannedData, setScannedData] = useState<ScannedItem[]>([]);
  const [personalScans, setPersonalScans] = useState<PersonalScanItem[]>([]);
  const [melCodesCount, setMelCodesCount] = useState(0);
  const [otherCodesCount, setOtherCodesCount] = useState(0);
  const [selectedScannerMode, setSelectedScannerMode] = useState('camara');
  const [scannerActive, setScannerActive] = useState(false);
  const [ingresarDatosEnabled, setIngresarDatosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState({
    isOpen: false,
    title: '',
    message: '',
    code: '',
    resolve: (value: boolean) => {},
  });
  const [cameraCapabilities, setCameraCapabilities] = useState<any>(null);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const isMobile = useIsMobile();


  // Refs para elementos del DOM y la instancia del escáner
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const physicalScannerInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  // Refs para valores que no necesitan re-renderizar el componente
  const lastScanTimeRef = useRef(Date.now());
  const lastSuccessfullyScannedCodeRef = useRef<string | null>(null);
  const scannedCodesRef = useRef(new Set<string>());
  const bufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbwxN5n-iE0pi3JlOkImBgWD3-qptWsJxdyMJjXbRySgGvi7jqIsU9Puo7p2uvu5BioIbQ/exec';
  const MIN_SCAN_INTERVAL = 500;

  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    const checkDbConnection = async () => {
      const { error } = await supabase.from('BASE DE DATOS ETIQUETAS IMPRESAS').select('Código').limit(1);
      if (error) {
        showAppMessage('Error de conexión a la base de datos.', 'duplicate');
        console.error("Database connection error:", error);
      } else {
        showAppMessage('Conexión a la base de datos exitosa.', 'success');
      }
    };
    checkDbConnection();
  }, []);

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

  const showAppMessage = (text: string, type: 'success' | 'duplicate' | 'info') => {
    setMessage({text, type});
  };

  const invalidateCSV = () => {
    setIngresarDatosEnabled(false);
  };
  
  const clearSessionData = () => {
    scannedCodesRef.current.clear();
    setScannedData([]);
    setPersonalScans([]);
    setMelCodesCount(0);
    setOtherCodesCount(0);
    lastSuccessfullyScannedCodeRef.current = null;
    setIngresarDatosEnabled(false);
  };

  const addCodeAndUpdateCounters = useCallback((codeToAdd: string, details: { sku: string | null; cantidad: number | null; producto: string | null; empresa: string | null; venta: string | null; }) => {
    const finalCode = codeToAdd.trim();

    if (scannedCodesRef.current.has(finalCode)) {
      showAppMessage(`DUPLICADO: ${finalCode}`, 'duplicate');
      return false;
    }

    scannedCodesRef.current.add(finalCode);
    lastSuccessfullyScannedCodeRef.current = finalCode;

    if (finalCode.startsWith('4')) {
        setMelCodesCount(prev => prev + 1);
    } else {
        setOtherCodesCount(prev => prev + 1);
    }
    
    showAppMessage(`Éxito: ${finalCode}`, 'success');

    if ('vibrate' in navigator) navigator.vibrate(200);

    const laserLine = document.getElementById('laser-line');
    if (laserLine) {
        laserLine.classList.add('laser-flash');
        laserLine.addEventListener('animationend', () => laserLine.classList.remove('laser-flash'), { once: true });
    }

    const now = new Date();
    const fechaEscaneo = now.toLocaleDateString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const horaEscaneo = now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const newData: ScannedItem = {
      code: finalCode,
      fecha: fechaEscaneo,
      hora: horaEscaneo,
      encargado: encargado.trim(),
      area: 'REVISIÓN CALIDAD',
      sku: details.sku,
      cantidad: details.cantidad,
      producto: details.producto,
      empresa: details.empresa,
      venta: details.venta,
    };
    
    setScannedData(prevData => [newData, ...prevData].sort((a, b) => new Date(`1970/01/01T${b.hora}`).valueOf() - new Date(`1970/01/01T${a.hora}`).valueOf()));

    invalidateCSV();
    return true;
  }, [encargado]);

  const associateNameToScans = async (name: string, pendingScans: ScannedItem[]) => {
    if (pendingScans.length === 0) {
      showAppMessage(`${name} escaneado, pero no había códigos pendientes.`, 'info');
      return;
    }
  
    setLoading(true);
    showAppMessage('Asociando códigos y consultando base de datos...', 'info');
  
    const newPersonalScansPromises = pendingScans.map(async (item) => {
      let sku: string | null = '';
      let producto: string | null = '';
      let cantidad: number | null = 0;
      let empresa: string | null = '';
      let venta: string | null = '';
  
      if (!item.sku || !item.producto || !item.cantidad || !item.empresa || !item.venta) {
          try {
            const { data, error } = await supabase
              .from('BASE DE DATOS ETIQUETAS IMPRESAS')
              .select('SKU, Producto, Cantidad, EMPRESA, Venta')
              .eq('Código', item.code)
              .single();
    
            if (error && error.code !== 'PGRST116') {
              throw error;
            }
    
            if (data) {
              sku = data.SKU || '';
              producto = data.Producto || '';
              cantidad = data.Cantidad || 0;
              empresa = data.EMPRESA || '';
              venta = data.Venta || '';
            } else {
              showAppMessage(`Código ${item.code} no encontrado. Se añade sin detalles.`, 'info');
            }
          } catch (e: any) {
            console.error(`Error al buscar el código ${item.code}:`, e.message);
            showAppMessage(`Error al buscar ${item.code}: ${e.message}`, 'duplicate');
          }
      } else {
        sku = item.sku;
        producto = item.producto;
        cantidad = item.cantidad;
        empresa = item.empresa;
        venta = item.venta;
      }
  
      return {
        code: item.code,
        sku: sku,
        personal: name, 
        encargado: item.encargado,
        product: producto,
        quantity: cantidad,
        organization: empresa,
        venta: venta,
        date: new Date().toISOString(),
      };
    });
  
    try {
      const newPersonalScans = await Promise.all(newPersonalScansPromises);
  
      setPersonalScans(prev => [...prev, ...newPersonalScans].sort((a, b) => a.code.localeCompare(b.code)));
      setScannedData([]);
      scannedCodesRef.current.clear();
      setMelCodesCount(0);
      setOtherCodesCount(0);
      showAppMessage(`Se asociaron ${newPersonalScans.length} códigos a ${name}.`, 'success');
    } catch (e: any) {
      showAppMessage(`Error al procesar los códigos: ${e.message}`, 'duplicate');
    } finally {
      setLoading(false);
    }
  };
  

  const showConfirmationDialog = (title: string, message: string, code: string): Promise<boolean> => {
      return new Promise((resolve) => {
          setConfirmation({ isOpen: true, title, message, code, resolve });
      });
  };

  const onScanSuccess = useCallback(async (decodedText: string, decodedResult: any) => {
    setLastScanned(decodedText);

    if (!scannerActive || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    lastScanTimeRef.current = Date.now();

    let finalCode = decodedText;
    try {
      const parsedJson = JSON.parse(decodedText);
      if (parsedJson && parsedJson.id) finalCode = parsedJson.id;
    } catch (e) {}

    if (isLikelyName(finalCode)) {
      if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
      associateNameToScans(finalCode, scannedData); 
      lastSuccessfullyScannedCodeRef.current = finalCode;
      return;
    }

    if (finalCode === lastSuccessfullyScannedCodeRef.current) return;
    
    setLoading(true);
    const { data, error } = await supabase
        .from('BASE DE DATOS ETIQUETAS IMPRESAS')
        .select('Código, SKU, Cantidad, Producto, EMPRESA, Venta')
        .eq('Código', finalCode)
        .single();
    setLoading(false);

    if (error && error.code !== 'PGRST116') {
        showAppMessage(`Error de base de datos: ${error.message}`, 'duplicate');
        return;
    }

    if (!data) {
        showAppMessage(`Error: Código ${finalCode} no encontrado en la base de datos.`, 'duplicate');
        return;
    }

    const { SKU, Cantidad, Producto, EMPRESA, Venta } = data;

    const isBarcode = decodedResult.result?.format?.formatName !== 'QR_CODE';
    let confirmed = true;

    if (isBarcode && finalCode.startsWith('4') && finalCode.length === 11) {
        confirmed = true;
    } else {
        const title = isBarcode ? 'Advertencia' : 'Confirmar Código';
        const message = isBarcode ? 'Este no es un código MEL, ¿desea agregar?' : 'Se ha detectado el siguiente código. ¿Desea agregarlo al registro?';
        confirmed = await showConfirmationDialog(title, message, finalCode);
    }

    if (confirmed) {
      addCodeAndUpdateCounters(finalCode, { sku: SKU, cantidad: Cantidad, producto: Producto, empresa: EMPRESA, venta: Venta });
    } else {
      showAppMessage('Escaneo cancelado.', 'info');
    }
  }, [scannerActive, addCodeAndUpdateCounters, associateNameToScans, scannedData]);

  const applyCameraConstraints = useCallback((track: MediaStreamTrack) => {
    if (!isMobile) return;
    track.applyConstraints({
      advanced: [{
        zoom: zoom,
        torch: isFlashOn
      }]
    }).catch(e => console.error("Failed to apply constraints", e));
  }, [zoom, isFlashOn, isMobile]);
  
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
        }).finally(() => {
            if(isMobile) {
              setCameraCapabilities(null);
              setIsFlashOn(false);
              setZoom(1);
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
          fps: 10,
          qrbox: { width: 250, height: 250 },
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        };
        html5QrCodeRef.current.start({ facingMode: "environment" }, config, onScanSuccess, (errorMessage) => {}).then(() => {
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
            console.error("Error al iniciar la cámara:", err);
            showAppMessage('Error al iniciar la cámara. Revisa los permisos.', 'duplicate');
            setScannerActive(false);
        });
      }
    } else {
      cleanup();
    }
  
    return () => {
      cleanup();
    };
  }, [scannerActive, selectedScannerMode, onScanSuccess, isMounted, isMobile]);


  useEffect(() => {
    const input = physicalScannerInputRef.current;
    const downListener = (e: Event) => handlePhysicalScannerInput(e as KeyboardEvent);
    
    if (selectedScannerMode === 'fisico' && scannerActive && input) {
      input.addEventListener('keydown', downListener);
      input.focus();
    }
    
    return () => {
      if (input) {
        input.removeEventListener('keydown', downListener);
      }
    };
  }, [scannerActive, selectedScannerMode]);
  
  const processPhysicalScan = async (code: string) => {
    if(!scannerActive || (Date.now() - lastScanTimeRef.current) < MIN_SCAN_INTERVAL) return;
    lastScanTimeRef.current = Date.now();

    let finalCode = code.trim().replace(/[^0-9A-Za-z]/g, '');
    const patternMatch = finalCode.match(/^id(\d{11})tlm$/i);
    if (patternMatch) {
        finalCode = patternMatch[1];
    }
    
    if (finalCode === lastSuccessfullyScannedCodeRef.current) return;

    setLoading(true);
    const { data, error } = await supabase
        .from('BASE DE DATOS ETIQUETAS IMPRESAS')
        .select('Código, SKU, Cantidad, Producto, EMPRESA, Venta')
        .eq('Código', finalCode)
        .single();
    setLoading(false);

    if (error && error.code !== 'PGRST116') {
        showAppMessage(`Error de base de datos: ${error.message}`, 'duplicate');
        return;
    }

    if (!data) {
        showAppMessage(`Error: Código ${finalCode} no encontrado en la base de datos.`, 'duplicate');
        return;
    }

    const { SKU, Cantidad, Producto, EMPRESA, Venta } = data;

    if(finalCode.startsWith('4') && finalCode.length === 11) {
        addCodeAndUpdateCounters(finalCode, { sku: SKU, cantidad: Cantidad, producto: Producto, empresa: EMPRESA, venta: Venta });
        return;
    }
    
    const isQrCodeLike = finalCode.length < 10 || finalCode.length > 14;
    let confirmed = true;

    if (isQrCodeLike || !finalCode.startsWith('4')) {
        const title = isQrCodeLike ? 'Confirmar Código' : 'Advertencia';
        const message = isQrCodeLike ? 'Se ha detectado el siguiente código. ¿Desea agregarlo al registro?': 'Este no es un código MEL, ¿desea agregar?';
        confirmed = await showConfirmationDialog(title, message, finalCode);
    }

    if (confirmed) {
        addCodeAndUpdateCounters(finalCode, { sku: SKU, cantidad: Cantidad, producto: Producto, empresa: EMPRESA, venta: Venta });
    } else {
        showAppMessage('Escaneo cancelado.', 'info');
    }
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
  
  const startScanner = () => {
    if (!encargado.trim()) return showAppMessage('Por favor, ingresa el nombre del encargado.', 'duplicate');
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
      if (selectedScannerMode === 'fisico') {
        bufferRef.current = '';
        if(scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        physicalScannerInputRef.current?.blur();
      }
    }
  };

  const handleConfirmation = (decision: boolean) => {
      confirmation.resolve(decision);
      setConfirmation({ isOpen: false, title: '', message: '', code: '', resolve: () => {} });
      if (selectedScannerMode === 'fisico' && scannerActive) {
          setTimeout(() => physicalScannerInputRef.current?.focus(), 100);
      }
  };

  const handleManualAdd = async () => {
      const manualCodeInput = document.getElementById('manual-code-input') as HTMLInputElement;
      if (!encargado.trim()) return showAppMessage('Por favor, ingresa el nombre del encargado.', 'duplicate');

      const manualCode = manualCodeInput.value.trim();
      if (!manualCode) return showAppMessage('Por favor, ingresa un código para agregar.', 'duplicate');

        setLoading(true);
        const { data, error } = await supabase
            .from('BASE DE DATOS ETIQUETAS IMPRESAS')
            .select('Código, SKU, Cantidad, Producto, EMPRESA, Venta')
            .eq('Código', manualCode)
            .single();
        setLoading(false);

        if (error && error.code !== 'PGRST116') { 
            showAppMessage(`Error de base de datos: ${error.message}`, 'duplicate');
            return;
        }

        if (!data) {
            showAppMessage(`Error: Código ${manualCode} no encontrado en la base de datos.`, 'duplicate');
            return;
        }

        const { SKU, Cantidad, Producto, EMPRESA, Venta } = data;

      let confirmed = true;
      if(!manualCode.startsWith('4')) {
          confirmed = await showConfirmationDialog('Advertencia', 'Este no es un código MEL, ¿desea agregar?', manualCode);
      }

      if(confirmed) {
          if(addCodeAndUpdateCounters(manualCode, { sku: SKU, cantidad: Cantidad, producto: Producto, empresa: EMPRESA, venta: Venta })) {
              manualCodeInput.value = '';
              manualCodeInput.focus();
          } else {
              manualCodeInput.select();
          }
      } else {
          showAppMessage('Ingreso cancelado.', 'info');
      }
  };
  
  const deleteRow = (codeToDelete: string) => {
    if (window.confirm(`¿Confirmas que deseas borrar el registro "${codeToDelete}"?`)) {
        setScannedData(prev => prev.filter(item => item.code !== codeToDelete));
        scannedCodesRef.current.delete(codeToDelete);

        if(codeToDelete.startsWith('4')) {
            setMelCodesCount(prev => prev - 1);
        } else {
            setOtherCodesCount(prev => prev - 1);
        }
        showAppMessage(`Registro ${codeToDelete} borrado.`, 'info');
        invalidateCSV();
    }
  };

  const exportCsv = async () => {
      if(scannedData.length === 0) return showAppMessage('No hay datos para exportar.', 'duplicate');
      
      try {
          const response = await fetch('https://worldtimeapi.org/api/timezone/America/Mexico_City');
          if (!response.ok) throw new Error(`Error en API de hora: ${response.status}`);
          const data = await response.json();
          const now = new Date(data.datetime);
          
          const encargadoName = (encargado || "SIN_NOMBRE").trim().toUpperCase().replace(/ /g, '_');
          const etiquetas = `ETIQUETAS(${scannedCodesRef.current.size})`;
          const removeAccents = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const areaName = removeAccents(("REVISIÓN CALIDAD").toUpperCase().replace(/ /g, '_'));

          const day = String(now.getDate()).padStart(2, '0');
          const year = String(now.getFullYear()).slice(-2);
          const monthNames = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
          const month = monthNames[now.getMonth()];
          const fechaFormateada = `${day}-${month}-${year}`;

          let hours = now.getHours();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12;
          hours = hours ? hours : 12;
          const timeString = `${String(hours).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}-${ampm}`;

          const fileName = `${encargadoName}-${etiquetas}-${areaName}-${fechaFormateada}-${timeString}.csv`;
          const BOM = "\uFEFF";
          const headers = "CODIGO,FECHA,HORA,ENCARGADO,AREA,SKU,CANTIDAD,PRODUCTO,EMPRESA,VENTA\n";
          let csvRows = scannedData.map(row => [`="${row.code}"`, `"${row.fecha}"`, `"${row.hora}"`, `"${row.encargado.replace(/"/g, '""')}"`, `"${row.area.replace(/"/g, '""')}"`, `"${row.sku || ''}"`, `"${row.cantidad || 0}"`, `"${(row.producto || '').replace(/"/g, '""')}"`, `"${(row.empresa || '').replace(/"/g, '""')}"`, `"${(row.venta || '').replace(/"/g, '""')}"`].join(',')).join('\n');
          
          const blob = new Blob([BOM + headers + csvRows], { type: 'text/csv;charset=utf-t' });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setIngresarDatosEnabled(true);
          showAppMessage('CSV exportado. Ahora puedes ingresar los datos.', 'success');

      } catch (error) {
          console.error("Error al exportar CSV:", error);
          showAppMessage('Error al obtener la hora de la red. Intenta de nuevo.', 'duplicate');
      }
  };

  const ingresarDatos = async () => {
    if (scannedData.length === 0) return showAppMessage('No hay datos para ingresar.', 'duplicate');
    setLoading(true);

    try {
        const { error } = await supabase.from('escaneos').insert(scannedData.map(item => ({
          codigo: item.code,
          fecha_escaneo: item.fecha,
          hora_escaneo: item.hora,
          encargado: item.encargado,
          area: item.area,
        })));

        if (error) throw error;
        
        showAppMessage(`¡Éxito! Se enviaron ${scannedData.length} registros a Supabase.`, 'success');
        clearSessionData();

    } catch (error: any) {
        console.error("Error al enviar datos a Supabase:", error);
        showAppMessage(`Error al enviar los datos: ${error.message}`, 'duplicate');
    } finally {
        setLoading(false);
    }
  };

  const handleSavePersonal = async () => {
    if (personalScans.length === 0) {
      showAppMessage('No hay datos de personal para guardar.', 'info');
      return;
    }
    setLoading(true);
    showAppMessage('Guardando registros de personal...', 'info');

    try {
      const dataToInsert = personalScans.map((item) => ({
        code: item.code,
        name: item.personal,
        name_inc: item.encargado,
        sku: item.sku,
        product: item.product,
        quantity: item.quantity,
        status: 'ASIGNADO',
        organization: item.organization,
        sales_num: item.venta,
        date: item.date,
      }));

      const { error } = await supabaseDB2.from('personal').insert(dataToInsert);

      if (error) {
        console.error("Supabase error:", error);
        throw error;
      }

      showAppMessage(`¡Éxito! Se guardaron ${personalScans.length} registros de personal.`, 'success');
      setPersonalScans([]);

    } catch (error: any) {
      console.error("Error al guardar datos de personal:", error);
      showAppMessage(`Error al guardar: ${error.message}`, 'duplicate');
    } finally {
      setLoading(false);
    }
  };

  const messageClasses: any = {
      success: 'scan-success',
      duplicate: 'scan-duplicate',
      info: 'scan-info'
  };

  return (
    <>
        <Head>
            <title>Asignar Empaquetado</title>
        </Head>

        <main className="text-starbucks-dark flex items-center justify-center p-4">
            <div className="w-full max-w-4xl mx-auto bg-starbucks-white rounded-xl shadow-2xl p-4 md:p-6 space-y-4">
                <header className="text-center">
                    <Image src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnQ4MGZzdXYzYWo1cXRiM3I1cjNoNjd4cjdia202ZXcwNjJ6YjdvbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QQO6BH98nhigF8FLsb/giphy.gif" alt="Scanner Logo" width={80} height={80} className="mx-auto h-20 w-auto mb-2" />
                    <h1 className="text-xl md:text-2xl font-bold text-starbucks-green">Asignar Empaquetado</h1>
                    <p className="text-gray-600 text-sm md:text-base mt-1">Asigna un producto a un miembro del personal.</p>
                </header>

                <div className="grid md:grid-cols-2 gap-4">
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
                            <button onClick={startScanner} disabled={scannerActive || !encargado} className={`px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 text-sm ${scannerActive || !encargado ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>Iniciar</button>
                            <button onClick={stopScanner} disabled={!scannerActive} className={`px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 text-sm ${!scannerActive ? 'bg-gray-400' : 'bg-red-600 hover:bg-red-700'}`}>Detener</button>
                        </div>

                        <div id="physical-scanner-status" className="mt-4 text-center p-2 rounded-md bg-starbucks-accent text-white" style={{ display: scannerActive && selectedScannerMode === 'fisico' ? 'block' : 'none' }}>
                            Escáner físico listo.
                        </div>
                    </div>
                </div>


                <div id="result-container" className="space-y-4">
                    <div id="message" className={`p-3 rounded-lg text-center font-semibold text-base transition-all duration-300 ${messageClasses[message.type]}`}>
                        {message.text}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-starbucks-cream p-2 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-xs">Total</h3>
                            <p id="total-scans" className="text-2xl font-mono text-starbucks-green">{melCodesCount + otherCodesCount}</p>
                        </div>
                        <div className="bg-starbucks-cream p-2 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-xs">Otros</h3>
                            <p id="other-scans" className="text-2xl font-mono text-yellow-500">{otherCodesCount}</p>
                        </div>
                        <div className="bg-starbucks-cream p-2 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-xs">MEL</h3>
                            <p id="unique-scans" className="text-2xl font-mono text-starbucks-accent">{melCodesCount}</p>
                        </div>
                    </div>
                </div>
                
                <div className="space-y-4">
                     <div className="p-4 bg-starbucks-cream rounded-lg">
                        <label htmlFor="manual-code-input" className="block text-sm font-bold text-starbucks-dark mb-1">Ingreso Manual:</label>
                        <div className="mt-1 flex rounded-md shadow-sm">
                            <input type="text" id="manual-code-input" className="form-input flex-1 block w-full rounded-none rounded-l-md" placeholder="Escriba el código..." onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}/>
                            <button type="button" id="manual-add-btn" onClick={handleManualAdd} className="inline-flex items-center px-4 py-2 border border-l-0 border-green-600 rounded-r-md bg-green-600 text-white hover:bg-green-700 font-semibold text-sm">
                                +
                            </button>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                           <h2 className="text-lg font-bold text-starbucks-dark">Personal Asignado</h2>
                            <button onClick={handleSavePersonal} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm text-sm transition-colors duration-200">
                                Guardar
                            </button>
                        </div>
                        <div className="table-container border border-gray-200 rounded-lg">
                            <table className="w-full min-w-full divide-y divide-gray-200">
                                <thead className="bg-starbucks-cream sticky top-0">
                                    <tr>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Codigo</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Personal</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Producto</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-starbucks-white divide-y divide-gray-200">
                                    {personalScans.map((data: PersonalScanItem) => (
                                        <tr key={data.code}>
                                            <td className="px-4 py-3 whitespace-nowrap font-mono text-sm">{data.code}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.personal}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.product}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div>
                        <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                            <h2 className="text-lg font-bold text-starbucks-dark">Registros Pendientes</h2>
                            <div className="flex flex-wrap gap-2">
                                <button id="export-csv" onClick={exportCsv} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm text-xs transition-colors duration-200">1. Exportar</button>
                                <button id="ingresar-datos" onClick={ingresarDatos} disabled={!ingresarDatosEnabled} className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white font-semibold rounded-lg shadow-sm text-xs transition-colors duration-200 disabled:bg-gray-400">2. Ingresar</button>
                                <button id="clear-data" onClick={() => { if(window.confirm('¿Estás seguro?')) clearSessionData() }} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg shadow-sm text-xs transition-colors duration-200">Limpiar</button>
                            </div>
                        </div>

                        <div className="table-container border border-gray-200 rounded-lg">
                            <table className="w-full min-w-full divide-y divide-gray-200">
                                <thead className="bg-starbucks-cream sticky top-0">
                                    <tr>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">CODIGO</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">PRODUCTO</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">SKU</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">CANT</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">EMPRESA</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Venta</th>
                                        <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">HORA</th>
                                        <th scope="col" className="px-4 py-2 text-center text-xs font-medium text-starbucks-dark uppercase tracking-wider">ACCION</th>
                                    </tr>
                                </thead>
                                <tbody id="scanned-list" className="bg-starbucks-white divide-y divide-gray-200">
                                    {scannedData.map((data: ScannedItem) => (
                                        <tr key={data.code}>
                                            <td className="px-4 py-3 whitespace-nowrap font-mono text-sm">{data.code}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.producto}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.sku}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.cantidad}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.empresa}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">{data.venta}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{data.hora}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                                                <button className="delete-btn text-red-500 hover:text-red-700 font-semibold text-xs" onClick={() => deleteRow(data.code)}>Borrar</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {loading && <div id="loading-overlay" style={{display: 'flex'}}>
                <div className="overlay-spinner"></div>
                <p className="text-lg font-semibold">Enviando registros...</p>
            </div>}
            
            {confirmation.isOpen && <div id="qr-confirmation-overlay" className="p-4" style={{display: 'flex'}}>
                 <div className="bg-starbucks-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center space-y-4">
                    <h3 id="confirmation-title" className="text-lg font-bold text-starbucks-dark">{confirmation.title}</h3>
                    <p id="confirmation-message" className="text-sm text-gray-600">{confirmation.message}</p>
                    <div id="qr-code-display" className="bg-starbucks-cream p-3 rounded-md font-mono text-xs break-words max-h-28 overflow-y-auto font-bold text-starbucks-dark">{confirmation.code}</div>
                    <div className="flex justify-center gap-4 mt-4">
                        <button id="qr-confirm-yes" onClick={() => handleConfirmation(true)} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md">Sí</button>
                        <button id="qr-confirm-no" onClick={() => handleConfirmation(false)} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md">No</button>
                    </div>
                </div>
            </div>}
        </main>
    </>
  );
}
