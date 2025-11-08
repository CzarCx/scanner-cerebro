'use client';
import {useEffect, useRef, useState} from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { QrCodeResultFormat } from 'html5-qrcode/core';

type ScannedItem = {
  code: string;
  fecha: string;
  hora: string;
  encargado: string;
  area: string;
};

export default function Home() {
  const [message, setMessage] = useState({text: 'Esperando para escanear...', type: 'info'});
  const [encargado, setEncargado] = useState('');
  const [scannedData, setScannedData] = useState<ScannedItem[]>([]);
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

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const physicalScannerInputRef = useRef<HTMLInputElement | null>(null);
  const zoomSliderRef = useRef<HTMLInputElement | null>(null);
  const camerasRef = useRef<any[]>([]);
  const currentCameraIndexRef = useRef(0);
  const lastScanTimeRef = useRef(0);
  const lastSuccessfullyScannedCodeRef = useRef<string | null>(null);
  const scannedCodesRef = useRef(new Set<string>());
  const bufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbwxN5n-iE0pi3JlOkImBgWD3-qptWsJxdyMJjXbRySgGvi7jqIsU9Puo7p2uvu5BioIbQ/exec';
  const MIN_SCAN_INTERVAL = 500;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      initializeScanner();
    }
  }, []);

  const initializeScanner = () => {
    if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode('reader', { verbose: false });
    }
    Html5Qrcode.getCameras()
      .then(devices => {
        if (devices && devices.length) {
          camerasRef.current = devices;
          const rearCameraIndex = camerasRef.current.findIndex(
            (camera: any) =>
              camera.label.toLowerCase().includes('back') ||
              camera.label.toLowerCase().includes('trasera')
          );
          if (rearCameraIndex !== -1) {
            currentCameraIndexRef.current = rearCameraIndex;
          }
        }
      })
      .catch(err => console.error('No se pudieron obtener las cámaras:', err));
  };

  const showAppMessage = (text: string, type: 'success' | 'duplicate' | 'info') => {
    setMessage({text, type});
  };

  const clearSessionData = () => {
    scannedCodesRef.current.clear();
    setScannedData([]);
    setMelCodesCount(0);
    setOtherCodesCount(0);
    lastSuccessfullyScannedCodeRef.current = null;
    setIngresarDatosEnabled(false);
  };

  const invalidateCSV = () => {
    setIngresarDatosEnabled(false);
  };

  const addCodeAndUpdateCounters = (codeToAdd: string) => {
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

    showAppMessage(`ÉXITO: ${finalCode}`, 'success');
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
    
    setScannedData(prevData => {
        const updatedData = [newData, ...prevData];
        updatedData.sort((a, b) => new Date(`1970/01/01T${b.hora}`).valueOf() - new Date(`1970/01/01T${a.hora}`).valueOf());
        return updatedData;
    });

    invalidateCSV();
    return true;
  };

  const onScanSuccess = async (decodedText: string, decodedResult: QrCodeResultFormat) => {
    if (!scannerActive || Date.now() - lastScanTimeRef.current < MIN_SCAN_INTERVAL) return;
    lastScanTimeRef.current = Date.now();

    let finalCode = decodedText;
    try {
      const parsedJson = JSON.parse(decodedText);
      if (parsedJson && parsedJson.id) finalCode = parsedJson.id;
    } catch (e) {}

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
        // Auto-accept MEL codes from barcodes
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
  };

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
      if(selectedScannerMode !== 'fisico' || !scannerActive) return;

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
    const input = physicalScannerInputRef.current;
    if (input) {
      const downListener = (e: Event) => handlePhysicalScannerInput(e as KeyboardEvent);
      input.addEventListener('keydown', downListener);
      return () => {
        input.removeEventListener('keydown', downListener);
      };
    }
  }, [scannerActive, selectedScannerMode]);
  
  const startScanner = () => {
    if (!encargado.trim()) return showAppMessage('Por favor, ingresa el nombre del encargado.', 'duplicate');
    if (!selectedArea) return showAppMessage('Por favor, selecciona un área.', 'duplicate');
    
    showAppMessage(selectedScannerMode === 'camara' ? 'Cámara activada. Apunta al código.' : 'Escáner físico activado. Conecta y comienza a escanear.', 'info');

    if(selectedScannerMode === 'camara') {
        startCameraScanner();
    } else {
        startPhysicalScanner();
    }
  };

  const stopScanner = () => {
    if(scannerActive) {
        if(selectedScannerMode === 'camara') {
            stopCameraScanner();
        } else {
            stopPhysicalScanner();
        }
    }
  };

  const startCameraScanner = () => {
    if (!camerasRef.current.length || !html5QrCodeRef.current) return showAppMessage('No se encontraron cámaras.', 'duplicate');
    const cameraId = (camerasRef.current[currentCameraIndexRef.current] as any).id;
    setScannerActive(true);

    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
        },
        formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // All formats
        videoConstraints: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: "environment"
        }
    };

    html5QrCodeRef.current.start(
        cameraId, 
        config,
        onScanSuccess, 
        (e: any) => {}
    ).then(() => {
        if (camerasRef.current.length > 1) setShowChangeCamera(true);
        const videoElement = document.querySelector('#reader video');
        if (videoElement) {
            videoTrackRef.current = (videoElement as HTMLVideoElement).srcObject.getVideoTracks()[0];
            const capabilities = videoTrackRef.current.getCapabilities();
            if(capabilities.torch || capabilities.zoom) setShowAdvancedControls(true);
            if(capabilities.torch) setShowFlashControl(true);
            if(capabilities.zoom) {
                setShowZoomControl(true);
                if(zoomSliderRef.current && capabilities.zoom) {
                    zoomSliderRef.current.min = capabilities.zoom.min.toString();
                    zoomSliderRef.current.max = capabilities.zoom.max.toString();
                    zoomSliderRef.current.step = capabilities.zoom.step.toString();
                    zoomSliderRef.current.value = capabilities.zoom.min.toString();
                }
            }
        }
    }).catch(err => {
        setScannerActive(false);
        showAppMessage('Error al iniciar la cámara. Revisa los permisos.', 'duplicate');
        console.error(err);
    });
  };

  const stopCameraScanner = () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().then(() => {
            setScannerActive(false);
            videoTrackRef.current = null;
            setShowAdvancedControls(false);
            setShowChangeCamera(false);
            showAppMessage('Escaneo detenido.', 'info');
        }).catch(err => console.error("Error al detener.", err));
    }
  };
  
  const startPhysicalScanner = () => {
      setScannerActive(true);
      physicalScannerInputRef.current?.focus();
      showAppMessage('Escáner físico activo. Escanea códigos.', 'info');
  };

  const stopPhysicalScanner = () => {
      setScannerActive(false);
      bufferRef.current = '';
      if(scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      physicalScannerInputRef.current?.blur();
      showAppMessage('Escáner físico detenido.', 'info');
  };

  const changeCamera = () => {
      if (scannerActive && camerasRef.current.length > 1 && html5QrCodeRef.current) {
          html5QrCodeRef.current.stop().then(() => {
              currentCameraIndexRef.current = (currentCameraIndexRef.current + 1) % camerasRef.current.length;
              startCameraScanner();
          });
      }
  };

  const toggleFlash = () => {
      if(videoTrackRef.current && 'applyConstraints' in videoTrackRef.current) {
          const newFlashState = !isFlashOn;
          (videoTrackRef.current as any).applyConstraints({ advanced: [{ torch: newFlashState }] });
          setIsFlashOn(newFlashState);
      }
  };

  const handleZoom = (event: React.ChangeEvent<HTMLInputElement>) => {
      if(videoTrackRef.current && 'applyConstraints' in videoTrackRef.current) {
          try {
              (videoTrackRef.current as any).applyConstraints({ advanced: [{ zoom: event.target.value }] });
          } catch(error) {
              console.error("Error al aplicar zoom:", error);
          }
      }
  };

  const showConfirmationDialog = (title: string, message: string, code: string): Promise<boolean> => {
      return new Promise((resolve) => {
          if (scannerActive && selectedScannerMode === 'camara' && html5QrCodeRef.current?.getState() === Html5QrcodeScannerState.SCANNING) {
              html5QrCodeRef.current?.pause(true);
          }
          setConfirmation({ isOpen: true, title, message, code, resolve });
      });
  };

  const handleConfirmation = (decision: boolean) => {
      confirmation.resolve(decision);
      setConfirmation({ isOpen: false, title: '', message: '', code: '', resolve: () => {} });
      if (scannerActive && selectedScannerMode === 'camara' && html5QrCodeRef.current?.getState() === Html5QrcodeScannerState.PAUSED) {
          html5QrCodeRef.current?.resume();
      }
      if (selectedScannerMode === 'fisico' && scannerActive) {
          setTimeout(() => physicalScannerInputRef.current?.focus(), 100);
      }
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
          
          const encargadoName = encargado.trim().toUpperCase().replace(/ /g, '_') || 'SIN_NOMBRE';
          const etiquetas = `ETIQUETAS(${scannedCodesRef.current.size})`;
          const removeAccents = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const areaName = removeAccents(selectedArea.toUpperCase().replace(/ /g, '_'));

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
          
          const blob = new Blob([BOM + headers + csvRows], { type: 'text/csv;charset=utf-8;' });
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
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            redirect: 'follow',
            body: JSON.stringify({ data: scannedData }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });
        if (response.ok) {
            showAppMessage(`¡Éxito! Se enviaron ${scannedData.length} registros.`, 'success');
            clearSessionData();
        } else {
            throw new Error(`Error del servidor: ${response.status}`);
        }
    } catch (error) {
        console.error("Error al enviar datos:", error);
        showAppMessage('Error al enviar los datos. Inténtalo de nuevo.', 'duplicate');
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
                        <div id="reader" style={{ display: selectedScannerMode === 'camara' ? 'block' : 'none' }}></div>
                        <div id="laser-line" style={{ display: scannerActive && selectedScannerMode === 'camara' ? 'block' : 'none' }}></div>
                        <input type="text" id="physical-scanner-input" ref={physicalScannerInputRef} className="hidden-input" autoComplete="off" readOnly />
                    </div>
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

        </main>
    </>
  );
  
    