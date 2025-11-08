'use client';
import {useEffect, useRef, useState, useCallback} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { supabase } from '@/lib/supabaseClient';
import { supabase as supabaseDB2 } from '@/lib/supabaseClient';


type ScannedItem = {
  code: string;
  fecha: string;
  hora: string;
  encargado: string;
  area: string;
};

type PersonalScanItem = {
  code: string;
  sku: string; // SKU will be empty for now
  personal: string;
  encargado: string;
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
  const [scannedData, setScannedData] = useState<ScannedItem[]>([]);
  const [personalScans, setPersonalScans] = useState<PersonalScanItem[]>([]);
  const [melCodesCount, setMelCodesCount] = useState(0);
  const [otherCodesCount, setOtherCodesCount] = useState(0);
  const [selectedArea, setSelectedArea] = useState('');
  const [selectedScannerMode, setSelectedScannerMode] = useState('camara');
  const [scannerActive, setScannerActive] = useState(false);
  const [ingresarDatosEnabled, setIngresarDatosEnabled] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showChangeCamera, setShowChangeCamera] = useState(false);
  const [showFlashControl, setShowFlashControl] = useState(false);
  const [showZoomControl, setShowZoomControl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState({
    isOpen: false,
    title: '',
    message: '',
    code: '',
    resolve: (value: boolean) => {},
  });
  const [successModal, setSuccessModal] = useState({
    isOpen: false,
    code: '',
  });

  // Refs para elementos del DOM y la instancia del escáner
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const physicalScannerInputRef = useRef<HTMLInputElement | null>(null);
  const zoomSliderRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  // Refs para valores que no necesitan re-renderizar el componente
  const camerasRef = useRef<any[]>([]);
  const currentCameraIndexRef = useRef(0);
  const lastScanTimeRef = useRef(Date.now());
  const lastSuccessfullyScannedCodeRef = useRef<string | null>(null);
  const scannedCodesRef = useRef(new Set<string>());
  const bufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbwxN5n-iE0pi3JlOkImBgWD3-qptWsJxdyMJjXbRySgGvi7jqIsU9Puo7p2uvu5BioIbQ/exec';
  const MIN_SCAN_INTERVAL = 500;

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

  const addCodeAndUpdateCounters = useCallback((codeToAdd: string) => {
    const finalCode = codeToAdd.trim();
    if (finalCode.startsWith('4') && finalCode.length !== 11) {
      alert(
        'Error de Escaneo: El código que inicia con 4 debe tener exactamente 11 dígitos. Intente nuevamente.'
      );
      return false;
    }
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
    
    setSuccessModal({ isOpen: true, code: finalCode });

    if ('vibrate' in navigator) navigator.vibrate(200);

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
      area: selectedArea,
    };
    
    setScannedData(prevData => [newData, ...prevData].sort((a, b) => new Date(`1970/01/01T${b.hora}`).valueOf() - new Date(`1970/01/01T${a.hora}`).valueOf()));

    invalidateCSV();
    return true;
  }, [encargado, selectedArea]);

  const associateNameToScans = (name: string, pendingScans: ScannedItem[]) => {
      const newPersonalScans: PersonalScanItem[] = [];
  
      pendingScans.forEach(item => {
        newPersonalScans.push({
          code: item.code,
          sku: '', // As per requirement, SKU is empty for now
          personal: name,
          encargado: item.encargado,
        });
      });
  
      if (newPersonalScans.length > 0) {
        setPersonalScans(prev => [...prev, ...newPersonalScans].sort((a, b) => a.code.localeCompare(b.code)));
        setScannedData([]); // Clear the unique scans table after association
        scannedCodesRef.current.clear(); // also clear the ref set
        setMelCodesCount(0);
        setOtherCodesCount(0);
        showAppMessage(`Se asociaron ${newPersonalScans.length} códigos a ${name}.`, 'success');
      } else {
        showAppMessage(`${name} escaneado, pero no había códigos pendientes.`, 'info');
      }
    };

  const showConfirmationDialog = (title: string, message: string, code: string): Promise<boolean> => {
      return new Promise((resolve) => {
          setConfirmation({ isOpen: true, title, message, code, resolve });
      });
  };

  const onScanSuccess = useCallback(async (decodedText: string, decodedResult: any) => {
    setLastScanned(decodedText);
    console.log(`Código escaneado (raw): ${decodedText}`);

    if (!scannerActive || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    lastScanTimeRef.current = Date.now();

    let finalCode = decodedText;
    try {
      const parsedJson = JSON.parse(decodedText);
      if (parsedJson && parsedJson.id) finalCode = parsedJson.id;
    } catch (e) {}

    // Check if it's a name
    if (isLikelyName(finalCode)) {
      if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
      associateNameToScans(finalCode, scannedData);
      lastSuccessfullyScannedCodeRef.current = finalCode; // Prevent re-scanning the same name
      return;
    }

    const isOnlyDigits = /^\d+$/.test(finalCode);
    if (finalCode.length > 30 && isOnlyDigits) {
      finalCode = finalCode.slice(-12);
    }

    if (finalCode === lastSuccessfullyScannedCodeRef.current) return;

    const laserLine = document.getElementById('laser-line');
    if (laserLine) {
        laserLine.classList.add('laser-flash');
        laserLine.addEventListener('animationend', () => laserLine.classList.remove('laser-flash'), { once: true });
    }

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
      addCodeAndUpdateCounters(finalCode);
    } else {
      showAppMessage('Escaneo cancelado.', 'info');
    }
  }, [scannerActive, addCodeAndUpdateCounters, associateNameToScans, scannedData]);


  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Efecto para inicializar y limpiar el escáner
  useEffect(() => {
    if (!isMounted || !readerRef.current) {
      return;
    }
  
    if (!html5QrCodeRef.current) {
      html5QrCodeRef.current = new Html5Qrcode(readerRef.current.id, false);
    }
    const qrCode = html5QrCodeRef.current;
  
    const cleanup = () => {
      if (qrCode && qrCode.getState() === Html5QrcodeScannerState.SCANNING) {
        return qrCode.stop().catch(err => {
          console.error("Fallo al detener el escáner en la limpieza", err);
        });
      }
      return Promise.resolve();
    };
  
    if (scannerActive && selectedScannerMode === 'camara') {
      if (qrCode.getState() !== Html5QrcodeScannerState.SCANNING) {
        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          videoConstraints: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              facingMode: "environment"
          }
        };
  
        Html5Qrcode.getCameras().then(devices => {
           if (devices && devices.length) {
             camerasRef.current = devices;
             const rearCameraIndex = devices.findIndex(
                 (camera: any) =>
                 camera.label.toLowerCase().includes('back') ||
                 camera.label.toLowerCase().includes('trasera')
             );
             if (rearCameraIndex !== -1) {
                 currentCameraIndexRef.current = rearCameraIndex;
             }
             if (devices.length > 1) setShowChangeCamera(true);

             const cameraId = devices[currentCameraIndexRef.current].id;
             
             qrCode.start(cameraId, config, onScanSuccess, (e: any) => {}).then(() => {
               const videoElement = document.querySelector(`#${readerRef.current!.id} video`);
               if (videoElement) {
                   const stream = (videoElement as HTMLVideoElement).srcObject as MediaStream;
                   const track = stream.getVideoTracks()[0];
                   videoTrackRef.current = track;
                   
                   const capabilities = track.getCapabilities();
                   if(capabilities.torch || capabilities.zoom) setShowAdvancedControls(true);
                   if(capabilities.torch) setShowFlashControl(true);
                   if(capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
                       setShowZoomControl(true);
                       if(zoomSliderRef.current) {
                           zoomSliderRef.current.min = capabilities.zoom.min!.toString();
                           zoomSliderRef.current.max = capabilities.zoom.max!.toString();
                           zoomSliderRef.current.step = capabilities.zoom.step!.toString();
                           zoomSliderRef.current.value = track.getSettings().zoom!.toString();
                       }
                   }
               }
             }).catch(err => {
                 console.error("Error al iniciar camara", err);
                 if (String(err).includes('transition')) return;
                 showAppMessage('Error al iniciar la cámara. Revisa los permisos.', 'duplicate');
                 setScannerActive(false);
             });
           }
        }).catch(err => {
           console.error('No se pudieron obtener las cámaras:', err);
           showAppMessage('No se encontraron cámaras.', 'duplicate');
           setScannerActive(false);
        });
      }
    } else if (!scannerActive) {
      cleanup();
    }
  
    return () => {
      cleanup();
    };
  }, [scannerActive, selectedScannerMode, onScanSuccess, isMounted]);


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

    if(finalCode.startsWith('4') && finalCode.length === 11) {
        addCodeAndUpdateCounters(finalCode);
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
        addCodeAndUpdateCounters(finalCode);
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
    if (!selectedArea) return showAppMessage('Por favor, selecciona un área.', 'duplicate');
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
      // Limpiar estados de controles de cámara
      setShowAdvancedControls(false);
      setShowChangeCamera(false);
      setShowFlashControl(false);
      setShowZoomControl(false);
      videoTrackRef.current = null;
      if (selectedScannerMode === 'fisico') {
        bufferRef.current = '';
        if(scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        physicalScannerInputRef.current?.blur();
      }
    }
  };

  const changeCamera = () => {
    const qrCode = html5QrCodeRef.current;
      if (scannerActive && camerasRef.current.length > 1 && qrCode) {
          qrCode.stop().then(() => {
            currentCameraIndexRef.current = (currentCameraIndexRef.current + 1) % camerasRef.current.length;
            const newCameraId = camerasRef.current[currentCameraIndexRef.current].id;
             const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                experimentalFeatures: { useBarCodeDetectorIfSupported: true },
                videoConstraints: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    facingMode: "environment"
                }
            };
            qrCode.start(newCameraId, config, onScanSuccess, (e: any) => {}).catch(err => {
              console.error("Error changing camera", err);
              showAppMessage('Error al cambiar de cámara.', 'duplicate');
            });
          });
      }
  };

  const toggleFlash = () => {
    const track = videoTrackRef.current;
    if(track && 'applyConstraints' in track) {
        const newFlashState = !isFlashOn;
        track.applyConstraints({ advanced: [{ torch: newFlashState }] }).then(() => {
            setIsFlashOn(newFlashState);
        }).catch(e => console.log('error flash', e));
    }
  };

  const handleZoom = (event: React.ChangeEvent<HTMLInputElement>) => {
    const track = videoTrackRef.current;
      if(track && 'applyConstraints' in track) {
          try {
              track.applyConstraints({ advanced: [{ zoom: event.target.value }] });
          } catch(error) {
              console.error("Error al aplicar zoom:", error);
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

  const handleSuccessModalClose = () => {
    setSuccessModal({ isOpen: false, code: '' });
    showAppMessage('Esperando para escanear...', 'info');
  };

  const handleManualAdd = async () => {
      const manualCodeInput = document.getElementById('manual-code-input') as HTMLInputElement;
      if (!encargado.trim()) return showAppMessage('Por favor, ingresa el nombre del encargado.', 'duplicate');
      if (!selectedArea) return showAppMessage('Por favor, selecciona un área.', 'duplicate');

      const manualCode = manualCodeInput.value.trim();
      if (!manualCode) return showAppMessage('Por favor, ingresa un código para agregar.', 'duplicate');

      let confirmed = true;
      if(!manualCode.startsWith('4')) {
          confirmed = await showConfirmationDialog('Advertencia', 'Este no es un código MEL, ¿desea agregar?', manualCode);
      }

      if(confirmed) {
          if(addCodeAndUpdateCounters(manualCode)) {
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
          const areaName = removeAccents((selectedArea || "SIN_AREA").toUpperCase().replace(/ /g, '_'));

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
          const headers = "CODIGO MEL,FECHA DE ESCANEO,HORA DE ESCANEO,ENCARGADO,AREA QUE REGISTRA\n";
          let csvRows = scannedData.map(row => [`="${row.code}"`, `"${row.fecha}"`, `"${row.hora}"`, `"${row.encargado.replace(/"/g, '""')}"`, `"${row.area.replace(/"/g, '""')}"`].join(',')).join('\n');
          
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

    try {
      const { data: lastIdData, error: lastIdError } = await supabaseDB2
        .from('personal')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();
  
      if (lastIdError && lastIdError.code !== 'PGRST116') { // PGRST116: no rows found
        throw lastIdError;
      }
  
      let nextId = (lastIdData?.id || 0) + 1;
  
      const dataToInsert = personalScans.map((item) => ({
        id: nextId++,
        name: item.personal,
        product: item.sku,
      }));

      const { error } = await supabaseDB2.from('personal').insert(dataToInsert);

      if (error) {
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
            <title>Escáner de Códigos</title>
        </Head>

        <main className="bg-starbucks-light-gray text-starbucks-dark min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-4xl mx-auto bg-starbucks-white rounded-xl shadow-2xl p-6 md:p-8 space-y-6">
                <header className="text-center">
                    <Image src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnQ4MGZzdXYzYWo1cXRiM3I1cjNoNjd4cjdia202ZXcwNjJ6YjdvbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QQO6BH98nhigF8FLsb/giphy.gif" alt="Scanner Logo" width={96} height={96} className="mx-auto h-24 w-auto mb-4" />
                    <h1 className="text-2xl md:text-3xl font-bold text-starbucks-green">Escáner de Códigos</h1>
                    <p className="text-gray-600 mt-1">Escanea con cámara o escáner físico, exporta a CSV y luego ingresa los datos.</p>
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

                <div className="space-y-2">
                    <label className="block text-sm font-bold text-starbucks-dark mb-2">Área que Registra:</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button onClick={() => setSelectedArea('REVISIÓN CALIDAD')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedArea === 'REVISIÓN CALIDAD' ? 'area-selected' : ''}`} disabled={scannerActive}>REVISIÓN CALIDAD</button>
                        <button onClick={() => setSelectedArea('ENTREGA A COLECTA')} className={`area-btn w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none ${selectedArea === 'ENTREGA A COLECTA' ? 'area-selected' : ''}`} disabled={scannerActive}>ENTREGA A COLECTA</button>
                    </div>
                </div>

                <div className="bg-starbucks-cream p-4 rounded-lg">
                    <div className="scanner-container">
                        <div id="reader" ref={readerRef} style={{ display: selectedScannerMode === 'camara' ? 'block' : 'none' }}></div>
                        <div id="laser-line" style={{ display: scannerActive && selectedScannerMode === 'camara' ? 'block' : 'none' }}></div>
                        <input type="text" id="physical-scanner-input" ref={physicalScannerInputRef} className="hidden-input" autoComplete="off" />
                    </div>
                    {lastScanned && (
                        <p className="mt-2 text-center text-sm bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded relative">
                            <strong>Último escaneo detectado:</strong> {lastScanned}
                        </p>
                    )}
                    <div id="scanner-controls" className="mt-4 flex flex-wrap gap-2 justify-center">
                        <button onClick={startScanner} disabled={scannerActive} className={`px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 ${scannerActive ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}>Iniciar Escaneo</button>
                        <button onClick={stopScanner} disabled={!scannerActive} className={`px-4 py-2 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 ${!scannerActive ? 'bg-gray-400' : 'bg-red-600 hover:bg-red-700'}`}>Detener Escaneo</button>
                        {showChangeCamera && <button id="change-camera" onClick={changeCamera} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg shadow-md">Cambiar Cámara 📸</button>}
                    </div>
                    {showAdvancedControls && selectedScannerMode === 'camara' && (
                        <div id="camera-adv-controls" className="mt-4 p-4 bg-starbucks-cream rounded-lg space-y-4">
                            {showFlashControl && <div id="flash-control" className="text-center">
                                <button id="flash-btn" onClick={toggleFlash} className="w-full px-4 py-2 bg-gray-500 hover:bg-gray-700 text-white font-semibold rounded-lg shadow-md">{isFlashOn ? 'Desactivar Flash 💡' : 'Activar Flash 🔦'}</button>
                            </div>}
                           {showZoomControl && <div id="zoom-control" className="text-center">
                                <label htmlFor="zoom-slider" className="block mb-2 font-medium text-starbucks-dark">Zoom 🔎</label>
                                <input type="range" id="zoom-slider" ref={zoomSliderRef} onChange={handleZoom} className="w-full" />
                            </div>}
                        </div>
                    )}
                     <div id="physical-scanner-status" className="mt-4 text-center p-2 rounded-md bg-starbucks-accent text-white" style={{ display: scannerActive && selectedScannerMode === 'fisico' ? 'block' : 'none' }}>
                        Escáner físico listo. Conecta tu dispositivo y comienza a escanear.
                    </div>
                </div>

                <div id="result-container" className="space-y-4">
                    <div id="message" className={`p-4 rounded-lg text-center font-semibold text-lg transition-all duration-300 ${messageClasses[message.type]}`}>
                        {message.text}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                        <div className="bg-starbucks-cream p-3 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-sm">Escaneo Total</h3>
                            <p id="total-scans" className="text-3xl font-mono text-starbucks-green">{melCodesCount + otherCodesCount}</p>
                        </div>
                        <div className="bg-starbucks-cream p-3 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-sm">FedEx, P. Express, Otros</h3>
                            <p id="other-scans" className="text-3xl font-mono text-yellow-500">{otherCodesCount}</p>
                        </div>
                        <div className="bg-starbucks-cream p-3 rounded-lg">
                            <h3 className="font-bold text-starbucks-dark uppercase text-sm">Códigos MEL</h3>
                            <p id="unique-scans" className="text-3xl font-mono text-starbucks-accent">{melCodesCount}</p>
                        </div>
                    </div>
                </div>
                
                <div>
                     <div className="mb-4 p-4 bg-starbucks-cream rounded-lg">
                        <label htmlFor="manual-code-input" className="block text-sm font-bold text-starbucks-dark mb-2">Ingreso Manual (si el escáner falla):</label>
                        <div className="mt-1 flex rounded-md shadow-sm">
                            <input type="text" id="manual-code-input" className="form-input flex-1 block w-full rounded-none rounded-l-md" placeholder="Escriba el código aquí..." onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}/>
                            <button type="button" id="manual-add-btn" onClick={handleManualAdd} className="inline-flex items-center px-4 py-2 border border-l-0 border-green-600 rounded-r-md bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 font-semibold">
                                Agregar +
                            </button>
                        </div>
                    </div>

                    <div className="mb-4">
                        <div className="flex justify-between items-center mb-2">
                           <h2 className="text-xl font-bold text-starbucks-dark">Registros de Personal</h2>
                            <button onClick={handleSavePersonal} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm text-sm transition-colors duration-200">
                                Guardar Personal
                            </button>
                        </div>
                        <div className="table-container border border-gray-200 rounded-lg">
                            <table className="w-full min-w-full divide-y divide-gray-200">
                                <thead className="bg-starbucks-cream sticky top-0">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Codigo (MEL o otro)</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">SKU</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Personal</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">Encargado</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-starbucks-white divide-y divide-gray-200">
                                    {personalScans.map((data: PersonalScanItem) => (
                                        <tr key={data.code}>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono">{data.code}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{data.sku}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">{data.personal}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">{data.encargado}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>


                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-xl font-bold text-starbucks-dark">Registros Únicos</h2>
                        <div className="flex flex-wrap gap-2">
                            <button id="export-csv" onClick={exportCsv} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm text-sm transition-colors duration-200">1. Exportar CSV</button>
                            <button id="ingresar-datos" onClick={ingresarDatos} disabled={!ingresarDatosEnabled} className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white font-semibold rounded-lg shadow-sm text-sm transition-colors duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed">2. Ingresar Datos</button>
                            <button id="clear-data" onClick={() => { if(window.confirm('¿Estás seguro?')) clearSessionData() }} className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg shadow-sm text-sm transition-colors duration-200">Limpiar</button>
                        </div>
                    </div>

                    <div className="table-container border border-gray-200 rounded-lg">
                        <table className="w-full min-w-full divide-y divide-gray-200">
                            <thead className="bg-starbucks-cream sticky top-0">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">CODIGO MEL</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">FECHA</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">HORA</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">ENCARGADO</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-starbucks-dark uppercase tracking-wider">AREA</th>
                                    <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-starbucks-dark uppercase tracking-wider">ACCIONES</th>
                                </tr>
                            </thead>
                            <tbody id="scanned-list" className="bg-starbucks-white divide-y divide-gray-200">
                                {scannedData.map((data: ScannedItem) => (
                                    <tr key={data.code}>
                                        <td className="px-6 py-4 whitespace-nowrap font-mono">{data.code}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{data.fecha}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{data.hora}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">{data.encargado}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">{data.area}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                            <button className="delete-btn text-red-500 hover:text-red-700 font-semibold" onClick={() => deleteRow(data.code)}>Borrar</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {loading && <div id="loading-overlay" style={{display: 'flex'}}>
                <div className="overlay-spinner"></div>
                <p className="text-xl font-semibold">Enviando registros...</p>
            </div>}
            
            {confirmation.isOpen && <div id="qr-confirmation-overlay" className="p-4" style={{display: 'flex'}}>
                 <div className="bg-starbucks-white rounded-lg shadow-xl p-6 w-full max-w-md text-center space-y-4">
                    <h3 id="confirmation-title" className="text-lg font-bold text-starbucks-dark">{confirmation.title}</h3>
                    <p id="confirmation-message" className="text-sm text-gray-600">{confirmation.message}</p>
                    <div id="qr-code-display" className="bg-starbucks-cream p-3 rounded-md font-mono text-sm break-words max-h-40 overflow-y-auto font-bold text-starbucks-dark">{confirmation.code}</div>
                    <div className="flex justify-center gap-4 mt-4">
                        <button id="qr-confirm-yes" onClick={() => handleConfirmation(true)} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md">Sí, Agregar</button>
                        <button id="qr-confirm-no" onClick={() => handleConfirmation(false)} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md">No, Cancelar</button>
                    </div>
                </div>
            </div>}
            
            {successModal.isOpen && (
              <div className="p-4" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                <div className="bg-starbucks-white rounded-lg shadow-xl p-6 w-full max-w-md text-center space-y-4 text-starbucks-dark">
                  <h3 className="text-lg font-bold">¡Éxito!</h3>
                  <p>El código fue escaneado y guardado correctamente:</p>
                  <div className="bg-starbucks-cream p-3 rounded-md font-mono text-sm break-words max-h-40 overflow-y-auto font-bold">{successModal.code}</div>
                  <button onClick={handleSuccessModalClose} className="mt-4 px-6 py-2 bg-starbucks-green hover:bg-starbucks-accent text-white font-semibold rounded-lg shadow-md">
                    Aceptar
                  </button>
                </div>
              </div>
            )}

        </main>
    </>
  );
}

    
