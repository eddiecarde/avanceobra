-- Ubicación del proyecto para el encabezado del panel y el clima del día (municipio y coordenadas).
alter table projects add column location_name text;
alter table projects add column lat double precision check (lat between -90 and 90);
alter table projects add column lon double precision check (lon between -180 and 180);

-- Proyectos que ya tienen el área del mapa: el centro del área como coordenadas iniciales
update projects set lat = st_y(st_centroid(bbox)), lon = st_x(st_centroid(bbox)) where bbox is not null and lat is null;
