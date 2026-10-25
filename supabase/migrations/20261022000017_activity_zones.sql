-- AvanceObra · subcampo y circuito de cada actividad
-- En una planta solar el avance se sigue por subcampo (bloque de potencia) y circuito; el centro
-- de control filtra por ellos además de frente, actividad y empresa responsable.

alter table activities add column subfield text check (subfield is null or length(trim(subfield)) between 1 and 60);
alter table activities add column circuit text check (circuit is null or length(trim(circuit)) between 1 and 60);
