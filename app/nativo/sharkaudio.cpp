// sharkaudio.exe — ayudante de audio de los clips de SharkTracker (C1b).
//
// Invisible y sin ventana, como FFmpeg: la app lo abre al empezar la partida y lo
// cierra al terminar. Captura el sonido con WASAPI y lo manda por la salida
// estándar como PCM float de 32 bits, 48 kHz, estéreo (la app se lo pasa a FFmpeg).
//
//   sharkaudio dispositivos
//       → JSON con las salidas (altavoces/auriculares) y entradas (micrófonos).
//   sharkaudio capturar --fuente tipo:volumen:valor [--fuente …] [--separadas]
//       tipo programa: valor = nombres de .exe separados por coma ("League of Legends.exe").
//                      Solo el sonido de ese programa y sus hijos (captura por proceso,
//                      Windows 10 2004+ / Windows 11). Si el programa no está abierto
//                      (Discord), se reintenta cada 3 s.
//       tipo mic:      valor = id del micrófono o "defecto".
//       tipo pc:       valor = id de la salida o "defecto": todo lo que suena en el PC.
//       volumen: 0–200 (%).
//       Sin --separadas: 2 canales (la mezcla). Con --separadas: 2 + 2 por fuente
//       (la mezcla y luego cada fuente, en el orden de los argumentos).
//       --niveles N: cada N s (30 de fábrica) avisa qué llegó de cada fuente (nivel en dB,
//       "silencio" o "no llega nada"); la app lo guarda en registro.txt.
//
// El audio sale al ritmo del reloj del PC (QueryPerformanceCounter), con 50 ms de
// retraso fijo para tener margen: si una fuente no manda nada (silencio, programa
// cerrado), esa parte va en silencio; así el audio nunca se corre respecto del video.
// Los avisos van por la salida de errores (la app los guarda en registro.txt).
//
// Compilar: ver compilar.cmd (Visual Studio) o, desde Linux, con MinGW:
//   x86_64-w64-mingw32-g++ -std=c++17 -O2 -static -municode sharkaudio.cpp -o sharkaudio.exe
//     -lole32 -lmmdevapi -luuid -lpropsys -lwinmm

#ifndef UNICODE
#define UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <tlhelp32.h>
#include <shellapi.h>
#include <fcntl.h>
#include <io.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <deque>
#include <memory>
#include <string>
#include <vector>

#if defined(__has_include)
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#define TIENE_ACTIVATION_PARAMS 1
#endif
#endif

#ifndef TIENE_ACTIVATION_PARAMS
// MinGW todavía no trae esta cabecera (Windows SDK 10.0.20348+).
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum PROCESS_LOOPBACK_MODE {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif
#ifndef AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
#define AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY 0x08000000
#endif

static const int HZ = 48000;
static const int RETRASO_MS = 50;        // margen fijo (la app lo descuenta en FFmpeg)
static const size_t MAX_COLA = HZ / 5;   // 200 ms: más que esto en cola = se descarta lo viejo
static const size_t COLA_OBJETIVO = HZ / 20; // al descartar, se deja en 50 ms

// ── Utilidades ──
static std::string utf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
  return s;
}

static void aviso(const std::wstring& texto) {
  std::string s = utf8(texto) + "\n";
  fwrite(s.data(), 1, s.size(), stderr);
  fflush(stderr);
}

static std::wstring hex(HRESULT hr) {
  wchar_t b[16];
  swprintf(b, 16, L"0x%08lX", (unsigned long)hr);
  return b;
}

static std::string json(const std::wstring& w) {
  std::string s = utf8(w), o = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o + "\"";
}

static std::wstring minusculas(std::wstring s) {
  for (auto& c : s) c = (wchar_t)towlower(c);
  return s;
}

// Formato que se pide para la captura por proceso: PCM 16 bits, 48 kHz, estéreo.
static WAVEFORMATEX formato() {
  WAVEFORMATEX f = {};
  f.wFormatTag = WAVE_FORMAT_PCM;
  f.nChannels = 2;
  f.nSamplesPerSec = HZ;
  f.wBitsPerSample = 16;
  f.nBlockAlign = 4;
  f.nAvgBytesPerSec = HZ * 4;
  return f;
}

// ── Activación asíncrona (captura por proceso) ──
class Activacion : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  LONG refs = 1;
 public:
  HANDLE listo = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  virtual ~Activacion() { CloseHandle(listo); }
  STDMETHODIMP QueryInterface(REFIID riid, void** p) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *p = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *p = static_cast<IAgileObject*>(this);
    } else { *p = nullptr; return E_NOINTERFACE; }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&refs); if (!r) delete this; return r; }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation*) override { SetEvent(listo); return S_OK; }
};

static IAudioClient* clienteDeProceso(DWORD pid, HRESULT* error) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);
  Activacion* h = new Activacion();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, h, &op);
  IAudioClient* cliente = nullptr;
  if (SUCCEEDED(hr)) {
    if (WaitForSingleObject(h->listo, 5000) != WAIT_OBJECT_0) hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    else {
      HRESULT hrAct = E_FAIL;
      IUnknown* unk = nullptr;
      hr = op->GetActivateResult(&hrAct, &unk);
      if (SUCCEEDED(hr)) hr = hrAct;
      if (SUCCEEDED(hr) && unk) hr = unk->QueryInterface(__uuidof(IAudioClient), (void**)&cliente);
      if (unk) unk->Release();
    }
  }
  if (op) op->Release();
  h->Release();
  if (FAILED(hr) && cliente) { cliente->Release(); cliente = nullptr; }
  *error = hr;
  return cliente;
}

// ── Formato de una captura y conversión a float estéreo 48 kHz ──
// Los dispositivos se capturan en su propio formato (el de la mezcla de Windows):
// pedirle a Windows que convierta falla con algunos dispositivos virtuales (Wave Link,
// Voicemeeter…). La captura por proceso sí se pide en PCM 16 bits 48 kHz estéreo.
struct Formato {
  enum Tipo { I16, I24, I32, F32 } tipo = I16;
  int canales = 2;
  int hz = HZ;
  int bytesMuestra = 2;
  int bloque = 4;
};

static Formato leerFormato(const WAVEFORMATEX* w) {
  Formato f;
  f.canales = std::max<int>(1, w->nChannels);
  f.hz = (int)w->nSamplesPerSec;
  f.bloque = w->nBlockAlign;
  f.bytesMuestra = std::max(1, f.bloque / f.canales);
  WORD etiqueta = w->wFormatTag;
  if (etiqueta == WAVE_FORMAT_EXTENSIBLE && w->cbSize >= 22) {
    // El subformato es un GUID cuyo primer campo es la etiqueta clásica (1 = PCM, 3 = float).
    etiqueta = (WORD)reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(w)->SubFormat.Data1;
  }
  if (etiqueta == WAVE_FORMAT_IEEE_FLOAT) f.tipo = Formato::F32;
  else f.tipo = f.bytesMuestra == 2 ? Formato::I16 : f.bytesMuestra == 3 ? Formato::I24 : Formato::I32;
  return f;
}

static std::wstring describir(const Formato& f) {
  const wchar_t* t = f.tipo == Formato::F32 ? L"float" : f.tipo == Formato::I16 ? L"16 bits" : f.tipo == Formato::I24 ? L"24 bits" : L"32 bits";
  return std::to_wstring(f.hz) + L" Hz, " + std::to_wstring(f.canales) + L" canales, " + t;
}

static inline float muestra(const BYTE* p, Formato::Tipo t) {
  switch (t) {
    case Formato::I16: { int16_t v; memcpy(&v, p, 2); return v / 32768.f; }
    case Formato::I24: { int32_t v = (int32_t)((uint32_t)p[0] << 8 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 24); return v / 2147483648.f; }
    case Formato::I32: { int32_t v; memcpy(&v, p, 4); return v / 2147483648.f; }
    default: { float v; memcpy(&v, p, 4); return v; }
  }
}

// Lo que se recibió de una fuente (para el registro y "Probar audio").
struct Medida {
  long long frames = 0;  // frames recibidos
  float pico = 0.f;      // nivel máximo (0–1)
};

// ── Una captura (un proceso o un dispositivo) ──
struct Captura {
  IAudioClient* cliente = nullptr;
  IAudioCaptureClient* captura = nullptr;
  HANDLE evento = nullptr;
  DWORD pid = 0;          // si es de un programa
  bool viva = true;
  Formato fmt;
  // Cambio de frecuencia (si el dispositivo no va a 48 kHz): interpolación lineal.
  double pos = 0.0;
  float prevL = 0.f, prevR = 0.f;
  bool hayPrev = false;

  ~Captura() {
    if (cliente) cliente->Stop();
    if (captura) captura->Release();
    if (cliente) cliente->Release();
    if (evento) CloseHandle(evento);
  }

  // propio = true: en el formato del dispositivo (GetMixFormat). false: PCM 16 bits 48 kHz estéreo.
  bool iniciar(IAudioClient* c, DWORD flags, bool propio, std::wstring* error) {
    cliente = c;
    WAVEFORMATEX fijo = formato();
    WAVEFORMATEX* mezcla = nullptr;
    const WAVEFORMATEX* pedido = &fijo;
    HRESULT hr = S_OK;
    if (propio) {
      hr = cliente->GetMixFormat(&mezcla);
      if (FAILED(hr) || !mezcla) { *error = L"sin formato: " + hex(hr); return false; }
      pedido = mezcla;
    }
    fmt = leerFormato(pedido);
    evento = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    hr = cliente->Initialize(AUDCLNT_SHAREMODE_SHARED, flags | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                             2000000 /* 200 ms */, 0, pedido, nullptr);
    if (mezcla) CoTaskMemFree(mezcla);
    if (SUCCEEDED(hr)) hr = cliente->SetEventHandle(evento);
    if (SUCCEEDED(hr)) hr = cliente->GetService(__uuidof(IAudioCaptureClient), (void**)&captura);
    if (SUCCEEDED(hr)) hr = cliente->Start();
    if (FAILED(hr)) { *error = hex(hr); return false; }
    return true;
  }

  // Un frame ya en estéreo, a 48 kHz.
  inline void meter(std::deque<float>& cola, float l, float r) {
    if (fmt.hz == HZ) { cola.push_back(l); cola.push_back(r); return; }
    if (!hayPrev) { prevL = l; prevR = r; hayPrev = true; pos = 0.0; return; }
    const double paso = (double)fmt.hz / HZ;
    while (pos <= 1.0) {
      cola.push_back(prevL + (l - prevL) * (float)pos);
      cola.push_back(prevR + (r - prevR) * (float)pos);
      pos += paso;
    }
    pos -= 1.0;
    prevL = l;
    prevR = r;
  }

  // Pasa lo capturado a la cola de la fuente (float estéreo 48 kHz).
  void leer(std::deque<float>& cola, Medida& m) {
    if (!viva) return;
    const int ch = fmt.canales;
    float s[8];
    for (;;) {
      UINT32 paquete = 0;
      HRESULT hr = captura->GetNextPacketSize(&paquete);
      if (FAILED(hr)) { viva = false; return; }
      if (!paquete) return;
      BYTE* datos = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = captura->GetBuffer(&datos, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) { viva = false; return; }
      const bool silencio = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
      m.frames += frames;
      for (UINT32 i = 0; i < frames; i++) {
        float l = 0.f, r = 0.f;
        if (!silencio) {
          const BYTE* fila = datos + (size_t)i * fmt.bloque;
          const int n = std::min(ch, 8);
          for (int k = 0; k < n; k++) s[k] = muestra(fila + (size_t)k * fmt.bytesMuestra, fmt.tipo);
          if (ch == 1) { l = r = s[0]; }
          else if (ch == 2) { l = s[0]; r = s[1]; }
          else if (ch == 4) { l = s[0] + 0.5f * s[2]; r = s[1] + 0.5f * s[3]; }  // cuadrafónico
          else {
            // 5.1 / 7.1 (FL FR FC LFE BL BR SL SR): centro y traseros a los dos lados.
            l = s[0] + 0.707f * s[2];
            r = s[1] + 0.707f * s[2];
            if (ch >= 6) { l += 0.5f * s[4]; r += 0.5f * s[5]; }
            if (ch >= 8) { l += 0.5f * s[6]; r += 0.5f * s[7]; }
          }
          m.pico = std::max(m.pico, std::max(std::fabs(l), std::fabs(r)));
        }
        meter(cola, l, r);
      }
      captura->ReleaseBuffer(frames);
    }
  }
};

// ── Fuentes ──
enum class Tipo { Programa, Mic, Pc };

struct Fuente {
  Tipo tipo;
  float volumen = 1.f;
  std::wstring valor;                          // nombres de programa, id o "defecto"
  std::vector<std::wstring> programas;         // en minúsculas
  std::vector<std::unique_ptr<Captura>> capturas;
  std::deque<float> cola;                      // muestras estéreo intercaladas
  ULONGLONG ultimoIntento = 0;
  bool avisoAusente = false;
  Medida medida;                               // lo recibido desde el último informe
  std::wstring etiqueta;                       // para los avisos: "Juego", "PC", "Micrófono"
};

static std::wstring nombreDispositivo(IMMDevice* d) {
  std::wstring nombre = L"(sin nombre)";
  IPropertyStore* ps = nullptr;
  if (SUCCEEDED(d->OpenPropertyStore(STGM_READ, &ps))) {
    PROPVARIANT v;
    PropVariantInit(&v);
    if (SUCCEEDED(ps->GetValue(PKEY_Device_FriendlyName, &v)) && v.vt == VT_LPWSTR) nombre = v.pwszVal;
    PropVariantClear(&v);
    ps->Release();
  }
  return nombre;
}

static IMMDeviceEnumerator* enumerador = nullptr;

static IMMDevice* dispositivo(Tipo tipo, const std::wstring& valor) {
  IMMDevice* d = nullptr;
  EDataFlow flujo = tipo == Tipo::Mic ? eCapture : eRender;
  if (valor.empty() || valor == L"defecto") enumerador->GetDefaultAudioEndpoint(flujo, eConsole, &d);
  else if (FAILED(enumerador->GetDevice(valor.c_str(), &d))) enumerador->GetDefaultAudioEndpoint(flujo, eConsole, &d);
  return d;
}

static void abrirDispositivo(Fuente& f) {
  std::wstring error;
  IMMDevice* d = dispositivo(f.tipo, f.valor);
  if (!d) {
    if (!f.avisoAusente) aviso(f.etiqueta + L": no hay dispositivo de sonido");
    f.avisoAusente = true;
    return;
  }
  f.avisoAusente = false;
  const std::wstring nombre = nombreDispositivo(d);
  IAudioClient* c = nullptr;
  HRESULT hr = d->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&c);
  d->Release();
  if (FAILED(hr)) { aviso(f.etiqueta + L": no se pudo abrir " + nombre + L" (" + hex(hr) + L")"); return; }
  auto cap = std::make_unique<Captura>();
  DWORD flags = f.tipo == Tipo::Pc ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
  if (!cap->iniciar(c, flags, true, &error)) { aviso(f.etiqueta + L": no se pudo capturar " + nombre + L" (" + error + L")"); return; }
  aviso(f.etiqueta + L": capturando " + nombre + L" (" + describir(cap->fmt) + L")");
  f.capturas.push_back(std::move(cap));
}

// Procesos "raíz" del programa (su padre no es el mismo programa): con el árbol
// incluido, eso cubre todos sus procesos hijos (Discord tiene varios).
static std::vector<DWORD> raices(const std::vector<std::wstring>& nombres) {
  std::vector<std::pair<DWORD, DWORD>> lista; // pid, padre
  std::vector<DWORD> todos;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return {};
  PROCESSENTRY32W pe = {};
  pe.dwSize = sizeof(pe);
  for (BOOL ok = Process32FirstW(snap, &pe); ok; ok = Process32NextW(snap, &pe)) {
    std::wstring n = minusculas(pe.szExeFile);
    if (std::find(nombres.begin(), nombres.end(), n) != nombres.end()) {
      lista.push_back({ pe.th32ProcessID, pe.th32ParentProcessID });
      todos.push_back(pe.th32ProcessID);
    }
  }
  CloseHandle(snap);
  std::vector<DWORD> r;
  for (auto& p : lista) if (std::find(todos.begin(), todos.end(), p.second) == todos.end()) r.push_back(p.first);
  return r;
}

static bool procesoVivo(DWORD pid) {
  HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
  if (!h) return false;
  bool vivo = WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
  CloseHandle(h);
  return vivo;
}

static void revisarPrograma(Fuente& f) {
  // Fuera las capturas de procesos que ya se cerraron.
  f.capturas.erase(std::remove_if(f.capturas.begin(), f.capturas.end(), [](const std::unique_ptr<Captura>& c) {
    return !c->viva || !procesoVivo(c->pid);
  }), f.capturas.end());
  for (DWORD pid : raices(f.programas)) {
    bool ya = std::any_of(f.capturas.begin(), f.capturas.end(), [pid](const std::unique_ptr<Captura>& c) { return c->pid == pid; });
    if (ya) continue;
    HRESULT hr = S_OK;
    IAudioClient* c = clienteDeProceso(pid, &hr);
    std::wstring error;
    if (!c) { aviso(f.etiqueta + L": no se pudo capturar " + f.valor + L" (pid " + std::to_wstring(pid) + L"): " + hex(hr)); continue; }
    auto cap = std::make_unique<Captura>();
    cap->pid = pid;
    if (!cap->iniciar(c, AUDCLNT_STREAMFLAGS_LOOPBACK, false, &error)) { aviso(f.etiqueta + L": no se pudo capturar " + f.valor + L" (" + error + L")"); continue; }
    f.capturas.push_back(std::move(cap));
    aviso(f.etiqueta + L": capturando " + f.valor + L" (pid " + std::to_wstring(pid) + L")");
    f.avisoAusente = false;
  }
  if (f.capturas.empty() && !f.avisoAusente) {
    aviso(f.etiqueta + L": esperando a que se abra " + f.valor);
    f.avisoAusente = true;
  }
}

static void revisarDispositivo(Fuente& f) {
  bool vivo = std::any_of(f.capturas.begin(), f.capturas.end(), [](const std::unique_ptr<Captura>& c) { return c->viva; });
  if (vivo) return;
  f.capturas.clear();
  abrirDispositivo(f); // se desconectó o cambió: se vuelve a abrir
}

// ── Modo "dispositivos" ──
static void listar(EDataFlow flujo, std::string& out) {
  IMMDeviceCollection* col = nullptr;
  std::wstring defecto;
  IMMDevice* def = nullptr;
  if (SUCCEEDED(enumerador->GetDefaultAudioEndpoint(flujo, eConsole, &def)) && def) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(def->GetId(&id))) { defecto = id; CoTaskMemFree(id); }
    def->Release();
  }
  out += "[";
  if (SUCCEEDED(enumerador->EnumAudioEndpoints(flujo, DEVICE_STATE_ACTIVE, &col))) {
    UINT n = 0;
    col->GetCount(&n);
    for (UINT i = 0; i < n; i++) {
      IMMDevice* d = nullptr;
      if (FAILED(col->Item(i, &d))) continue;
      LPWSTR id = nullptr;
      d->GetId(&id);
      const std::wstring nombre = nombreDispositivo(d);
      if (out.back() != '[') out += ",";
      out += "{\"id\":" + json(id ? id : L"") + ",\"nombre\":" + json(nombre) + ",\"defecto\":" + (id && defecto == id ? "true" : "false") + "}";
      if (id) CoTaskMemFree(id);
      d->Release();
    }
    col->Release();
  }
  out += "]";
}

static int modoDispositivos() {
  std::string out = "{\"salidas\":";
  listar(eRender, out);
  out += ",\"entradas\":";
  listar(eCapture, out);
  out += "}";
  fwrite(out.data(), 1, out.size(), stdout);
  fflush(stdout);
  return 0;
}

// ── Modo "capturar" ──
static bool escribir(HANDLE salida, const std::vector<float>& buf) {
  const char* p = reinterpret_cast<const char*>(buf.data());
  size_t falta = buf.size() * sizeof(float);
  while (falta) {
    DWORD escrito = 0;
    if (!WriteFile(salida, p, (DWORD)std::min<size_t>(falta, 1 << 20), &escrito, nullptr) || !escrito) return false;
    p += escrito;
    falta -= escrito;
  }
  return true;
}

// Informe para el registro de la app: qué llegó de cada fuente desde el último.
static void informarNiveles(std::deque<Fuente>& fuentes, int segundos) {
  std::wstring t = L"Niveles (" + std::to_wstring(segundos) + L" s):";
  for (size_t i = 0; i < fuentes.size(); i++) {
    auto& f = fuentes[i];
    t += (i ? L" ·" : L"") + std::wstring(L" ") + f.etiqueta + L" ";
    if (f.capturas.empty()) t += L"sin capturar";
    else if (!f.medida.frames) t += L"no llega nada";
    else if (f.medida.pico < 0.0001f) t += L"silencio";
    else {
      wchar_t b[32];
      swprintf(b, 32, L"%.0f dB", 20.0 * std::log10((double)f.medida.pico));
      t += b;
    }
    f.medida = Medida();
  }
  aviso(t);
}

static int modoCapturar(std::deque<Fuente>& fuentes, bool separadas, int cadaNiveles) {
  HANDLE salida = GetStdHandle(STD_OUTPUT_HANDLE);
  SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS); // pesa casi nada; que no se corte
  for (auto& f : fuentes) {
    if (f.tipo == Tipo::Programa) revisarPrograma(f);
    else abrirDispositivo(f);
    f.ultimoIntento = GetTickCount64();
  }
  const size_t canales = separadas ? 2 + 2 * fuentes.size() : 2;
  LARGE_INTEGER frec, t0, ahora;
  QueryPerformanceFrequency(&frec);
  QueryPerformanceCounter(&t0);
  long long enviados = 0;
  std::vector<float> buf;
  ULONGLONG ultimoInforme = GetTickCount64();
  timeBeginPeriod(1);
  for (;;) {
    Sleep(10);
    if (cadaNiveles > 0 && GetTickCount64() - ultimoInforme >= (ULONGLONG)cadaNiveles * 1000) {
      ultimoInforme = GetTickCount64();
      informarNiveles(fuentes, cadaNiveles);
    }
    for (auto& f : fuentes) {
      for (auto& c : f.capturas) c->leer(f.cola, f.medida);
      if (GetTickCount64() - f.ultimoIntento > 3000) {
        f.ultimoIntento = GetTickCount64();
        if (f.tipo == Tipo::Programa) revisarPrograma(f); else revisarDispositivo(f);
      }
      // Demasiado en cola (el reloj de la tarjeta va un poco más rápido): fuera lo viejo.
      if (f.cola.size() > MAX_COLA * 2) f.cola.erase(f.cola.begin(), f.cola.end() - COLA_OBJETIVO * 2);
    }
    QueryPerformanceCounter(&ahora);
    long long ms = (ahora.QuadPart - t0.QuadPart) * 1000 / frec.QuadPart - RETRASO_MS;
    if (ms <= 0) continue;
    long long deberia = ms * HZ / 1000;
    long long n = deberia - enviados;
    if (n <= 0) continue;
    buf.assign((size_t)n * canales, 0.f);
    for (size_t fi = 0; fi < fuentes.size(); fi++) {
      auto& f = fuentes[fi];
      for (long long i = 0; i < n; i++) {
        float l = 0.f, r = 0.f;
        if (f.cola.size() >= 2) { l = f.cola.front() * f.volumen; f.cola.pop_front(); r = f.cola.front() * f.volumen; f.cola.pop_front(); }
        float* fila = &buf[(size_t)i * canales];
        fila[0] += l;
        fila[1] += r;
        if (separadas) { fila[2 + fi * 2] = std::clamp(l, -1.f, 1.f); fila[3 + fi * 2] = std::clamp(r, -1.f, 1.f); }
      }
    }
    for (long long i = 0; i < n; i++) {
      float* fila = &buf[(size_t)i * canales];
      fila[0] = std::clamp(fila[0], -1.f, 1.f);
      fila[1] = std::clamp(fila[1], -1.f, 1.f);
    }
    enviados = deberia;
    if (!escribir(salida, buf)) break; // la app cerró la tubería: fin
  }
  timeEndPeriod(1);
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdout), _O_BINARY);
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) { aviso(L"COM: " + hex(hr)); return 2; }
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&enumerador);
  if (FAILED(hr)) { aviso(L"Sin acceso al sonido de Windows: " + hex(hr)); return 2; }

  std::wstring modo = argc > 1 ? argv[1] : L"";
  if (modo == L"dispositivos") return modoDispositivos();
  if (modo != L"capturar") {
    aviso(L"Uso: sharkaudio dispositivos | sharkaudio capturar --fuente tipo:volumen:valor [--separadas]");
    return 1;
  }
  std::deque<Fuente> fuentes; // deque: las fuentes no se mueven al agregar otra
  bool separadas = false;
  int cadaNiveles = 30; // informe de niveles por la salida de errores (0 = nunca)
  for (int i = 2; i < argc; i++) {
    std::wstring a = argv[i];
    if (a == L"--separadas") { separadas = true; continue; }
    if (a == L"--niveles" && i + 1 < argc) { cadaNiveles = std::clamp(_wtoi(argv[++i]), 0, 3600); continue; }
    if (a != L"--fuente" || i + 1 >= argc) { aviso(L"Argumento desconocido: " + a); return 1; }
    std::wstring v = argv[++i];
    size_t p1 = v.find(L':'), p2 = p1 == std::wstring::npos ? p1 : v.find(L':', p1 + 1);
    if (p2 == std::wstring::npos) { aviso(L"Fuente mal escrita: " + v); return 1; }
    Fuente& f = fuentes.emplace_back();
    std::wstring tipo = v.substr(0, p1);
    f.tipo = tipo == L"programa" ? Tipo::Programa : tipo == L"mic" ? Tipo::Mic : Tipo::Pc;
    if (tipo != L"programa" && tipo != L"mic" && tipo != L"pc") { aviso(L"Tipo de fuente desconocido: " + tipo); return 1; }
    f.volumen = std::clamp(_wtoi(v.substr(p1 + 1, p2 - p1 - 1).c_str()), 0, 200) / 100.f;
    f.valor = v.substr(p2 + 1);
    if (f.tipo == Tipo::Programa) {
      size_t ini = 0;
      for (;;) {
        size_t c = f.valor.find(L',', ini);
        std::wstring n = minusculas(f.valor.substr(ini, c == std::wstring::npos ? std::wstring::npos : c - ini));
        if (!n.empty()) f.programas.push_back(n);
        if (c == std::wstring::npos) break;
        ini = c + 1;
      }
    }
    // Nombre para los avisos: "League of Legends", "Discord", "Micrófono", "PC".
    if (f.tipo == Tipo::Mic) f.etiqueta = L"Micrófono";
    else if (f.tipo == Tipo::Pc) f.etiqueta = L"PC";
    else {
      std::wstring n = f.valor.substr(0, f.valor.find(L','));
      if (n.size() > 4 && minusculas(n.substr(n.size() - 4)) == L".exe") n.resize(n.size() - 4);
      f.etiqueta = n;
    }
  }
  if (fuentes.empty()) { aviso(L"Sin fuentes de audio"); return 1; }
  return modoCapturar(fuentes, separadas, cadaNiveles);
}
