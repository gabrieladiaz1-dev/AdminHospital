-- Reglas de negocio del PDF:
--  * El hospital cuenta con UNA sola ambulancia privada.
--  * 3ª planta: VIP-301..VIP-305, 1 cama cada una. 2ª planta: HAB-201..HAB-206, 2 camas cada una (17 camas).
-- Se aplican en la base de datos para que ningún cliente (web, Android, iOS) pueda saltárselas.
BEGIN;

-- 1) Ambulancia única ------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_single_ambulance() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.ambulances.single'));
  IF EXISTS (SELECT 1 FROM public.ambulances) THEN
    RAISE EXCEPTION 'El hospital cuenta con una sola ambulancia; edita la unidad existente.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_single_ambulance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_single_ambulance ON public.ambulances;
CREATE TRIGGER enforce_single_ambulance BEFORE INSERT ON public.ambulances
  FOR EACH ROW EXECUTE FUNCTION private.enforce_single_ambulance();

-- 2) Catálogo cerrado de habitaciones --------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_room_catalog() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT (
       (NEW.kind = 'vip'         AND NEW.floor_id = 3 AND NEW.code ~ '^VIP-30[1-5]$')
    OR (NEW.kind = 'semiprivada' AND NEW.floor_id = 2 AND NEW.code ~ '^HAB-20[1-6]$')
  ) THEN
    RAISE EXCEPTION 'Habitación fuera del catálogo: VIP-301..305 (3ª planta) o HAB-201..206 (2ª planta).' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind
     AND NEW.kind = 'vip' AND (SELECT count(*) FROM public.beds WHERE room_id = NEW.id) > 1 THEN
    RAISE EXCEPTION 'Una habitación VIP admite una sola cama.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_room_catalog() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_room_catalog ON public.rooms;
CREATE TRIGGER enforce_room_catalog BEFORE INSERT OR UPDATE OF code, kind, floor_id ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION private.enforce_room_catalog();

-- 3) Capacidad de camas por habitación (VIP 1, semiprivada 2) ---------------
CREATE OR REPLACE FUNCTION private.enforce_bed_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k public.room_kind; cap int; n int;
BEGIN
  -- Bloquea la habitación: dos inserciones concurrentes se serializan.
  SELECT kind INTO k FROM public.rooms WHERE id = NEW.room_id FOR UPDATE;
  cap := CASE k WHEN 'vip' THEN 1 ELSE 2 END;
  SELECT count(*) INTO n FROM public.beds WHERE room_id = NEW.room_id AND id <> NEW.id;
  IF n >= cap THEN
    RAISE EXCEPTION 'Capacidad completa: la habitación admite % cama(s).', cap USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_bed_capacity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_bed_capacity ON public.beds;
CREATE TRIGGER enforce_bed_capacity BEFORE INSERT OR UPDATE OF room_id ON public.beds
  FOR EACH ROW EXECUTE FUNCTION private.enforce_bed_capacity();

COMMIT;
