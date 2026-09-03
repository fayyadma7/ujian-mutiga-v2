-- Fix Realtime not working: table jawaban_ujian belum masuk publication supabase_realtime
-- Penyebab log: SUBSCRIBED -> CLOSED (tanpa err) karena publication kosong
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='jawaban_ujian'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.jawaban_ujian;
  END IF;
END $$;

-- Pastikan REPLICA IDENTITY FULL tetap (sudah di migration 20260714)
ALTER TABLE public.jawaban_ujian REPLICA IDENTITY FULL;

-- Pastikan RLS anon bisa SELECT untuk realtime (jika belum ada)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='jawaban_ujian' AND policyname='allow_anon_select_jawaban_realtime'
  ) THEN
    CREATE POLICY allow_anon_select_jawaban_realtime ON public.jawaban_ujian FOR SELECT TO anon USING (true);
  END IF;
END $$;
