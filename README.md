# SIS Comunitario – PWA

Portal de acceso a las aplicaciones de Salud Integral Familiar.

## Estructura de archivos

```
/
├── index.html              ← Menú principal (este archivo)
├── manifest.json           ← Manifest PWA
├── sw.js                   ← Service Worker (caché offline)
├── icon-192.png            ← Ícono PWA 192×192
├── icon-512.png            ← Ícono PWA 512×512
├── Vigilancia_Materna.html
├── calculadora_materna.html
├── mef.html
└── visita_domiciliar.html
```

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub (ej. `sis-comunitario`).
2. Sube **todos** los archivos anteriores a la rama `main`.
3. Ve a **Settings → Pages → Source** y selecciona `main / (root)`.
4. La URL será: `https://tu-usuario.github.io/sis-comunitario/`

> **Importante:** GitHub Pages sirve HTTPS automáticamente, requisito obligatorio para PWAs y Service Workers.

## Íconos

Renombra tus íconos exactamente así antes de subirlos:
- `icon-192.png` (192 × 192 px)
- `icon-512.png` (512 × 512 px)

## Instalar como app

Al abrir la URL en Chrome/Edge (Android o escritorio) aparecerá el botón **"Instalar"** en la pantalla de inicio. En iOS Safari, usa **Compartir → Agregar a pantalla de inicio**.

## Funcionamiento offline

El Service Worker (`sw.js`) guarda todos los archivos en caché local. Una vez instalada, la app funciona **sin conexión a internet**.
