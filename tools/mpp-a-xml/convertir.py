"""Convierte un cronograma de MS Project (.mpp) a XML de MS Project (.xml) con MPXJ.

El XML conserva tareas, fechas, predecesoras, líneas base, % completado, fechas reales y la fecha
de estado: la web de AvanceObra lo importa en Ajustes → Programación.

Uso: arrastrar el .mpp sobre "Convertir MPP a XML.bat" (o: python convertir.py archivo.mpp).
Requiere Java (Microsoft OpenJDK) y el paquete de Python "mpxj" (pip install mpxj).
"""
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("Arrastra un archivo .mpp sobre 'Convertir MPP a XML.bat'.")
        return 1
    import jpype  # noqa: F401  (lo instala mpxj)
    import mpxj  # noqa: F401  (registra las librerías de MPXJ)

    jpype.startJVM()
    from org.mpxj.mspdi import MSPDIWriter  # type: ignore
    from org.mpxj.reader import UniversalProjectReader  # type: ignore

    ok = 0
    for src in sys.argv[1:]:
        if not src.lower().endswith(".mpp"):
            print(f"Se omite (no es .mpp): {src}")
            continue
        out = os.path.splitext(src)[0] + ".xml"
        project = UniversalProjectReader().read(src)
        MSPDIWriter().write(project, out)
        tasks = sum(1 for t in project.getTasks() if t.getName() is not None)
        print(f"Listo: {out}  ({tasks} tareas)")
        ok += 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
