-- Run after the supplied table creation script.
-- These policies enforce the same role boundaries as the interface.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrowing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.write_audit(p_action text, p_module text, p_record_id bigint, p_description text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO public.audit_logs(user_id, action, module, record_id, description) VALUES (auth.uid(), p_action, p_module, p_record_id, p_description) $$;

CREATE POLICY "profiles own read" ON profiles FOR SELECT USING (id = auth.uid() OR public.current_role() = 'administrator');
CREATE POLICY "admins manage profiles" ON profiles FOR ALL USING (public.current_role() = 'administrator') WITH CHECK (public.current_role() = 'administrator');
CREATE POLICY "new profile" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "authenticated view equipment" ON equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage equipment" ON equipment FOR ALL USING (public.current_role() = 'administrator') WITH CHECK (public.current_role() = 'administrator');

CREATE POLICY "requesters read own requests" ON borrowing_requests FOR SELECT USING (requester_id = auth.uid() OR public.current_role() IN ('administrator','staff'));
CREATE POLICY "authenticated create requests" ON borrowing_requests FOR INSERT WITH CHECK (requester_id = auth.uid() AND status = 'Pending');
CREATE POLICY "admins update requests" ON borrowing_requests FOR UPDATE USING (public.current_role() = 'administrator') WITH CHECK (public.current_role() = 'administrator');
CREATE POLICY "staff process requests" ON borrowing_requests FOR UPDATE USING (public.current_role() = 'staff' AND status IN ('Approved','Released')) WITH CHECK (public.current_role() = 'staff');

CREATE POLICY "maintenance visibility" ON maintenance FOR SELECT USING (requested_by = auth.uid() OR public.current_role() IN ('administrator','staff'));
CREATE POLICY "maintenance create" ON maintenance FOR INSERT WITH CHECK (requested_by = auth.uid() AND public.current_role() IN ('staff','requester'));
CREATE POLICY "maintenance admins update" ON maintenance FOR UPDATE USING (public.current_role() IN ('administrator','staff')) WITH CHECK (public.current_role() IN ('administrator','staff'));

CREATE POLICY "admins read audit" ON audit_logs FOR SELECT USING (public.current_role() = 'administrator');
CREATE POLICY "authenticated audit insert" ON audit_logs FOR INSERT WITH CHECK (user_id = auth.uid());

-- Atomic release transition. It blocks rejected/pending requests, maintenance items,
-- insufficient quantity, and double releases at the database boundary.
CREATE OR REPLACE FUNCTION public.release_request(p_request_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row borrowing_requests%ROWTYPE;
BEGIN
  IF public.current_role() NOT IN ('administrator','staff') THEN RAISE EXCEPTION 'Only staff or administrators may release equipment'; END IF;
  SELECT * INTO request_row FROM borrowing_requests WHERE id = p_request_id FOR UPDATE;
  IF request_row.status <> 'Approved' THEN RAISE EXCEPTION 'Only Approved requests may be released'; END IF;
  UPDATE equipment SET available_quantity = available_quantity - request_row.quantity, status = CASE WHEN available_quantity - request_row.quantity = 0 THEN 'Borrowed' ELSE status END WHERE id = request_row.equipment_id AND status <> 'Maintenance' AND available_quantity >= request_row.quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipment is unavailable or under maintenance'; END IF;
  UPDATE borrowing_requests SET status = 'Released', released_at = now() WHERE id = p_request_id;
  PERFORM public.write_audit('RELEASED', 'Borrowing', p_request_id, 'Released approved equipment');
END; $$;

CREATE OR REPLACE FUNCTION public.return_request(p_request_id bigint, p_condition text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row borrowing_requests%ROWTYPE;
BEGIN
  IF public.current_role() NOT IN ('administrator','staff') THEN RAISE EXCEPTION 'Only staff or administrators may process returns'; END IF;
  SELECT * INTO request_row FROM borrowing_requests WHERE id = p_request_id FOR UPDATE;
  IF request_row.status <> 'Released' THEN RAISE EXCEPTION 'Only Released requests may be returned'; END IF;
  UPDATE equipment SET available_quantity = available_quantity + CASE WHEN p_condition = 'Good' THEN request_row.quantity ELSE 0 END, status = CASE WHEN p_condition = 'Damaged' THEN 'Maintenance' WHEN available_quantity + request_row.quantity >= quantity THEN 'Available' ELSE status END WHERE id = request_row.equipment_id;
  UPDATE borrowing_requests SET status = 'Returned', returned_at = now(), return_condition = p_condition WHERE id = p_request_id;
  PERFORM public.write_audit('RETURNED', 'Borrowing', p_request_id, 'Processed equipment return');
END; $$;

-- Seed the catalog. Safe to run more than once because asset_code is unique.
INSERT INTO public.equipment
  (asset_code, equipment_name, category, description, quantity, available_quantity, status)
VALUES
  ('LAP-001', 'Laboratory Laptop', 'Computer', 'Laptop for laboratory use', 5, 5, 'Available'),
  ('PROJ-001', 'Projector', 'Presentation', 'Multimedia projector', 2, 2, 'Available'),
  ('CAM-001', 'Digital Camera', 'Camera', 'Digital camera for laboratory activities', 3, 3, 'Available'),
  ('MIC-001', 'Microphone', 'Audio', 'Wireless microphone', 4, 4, 'Available'),
  ('MON-001', 'Computer Monitor', 'Computer', 'LED computer monitor', 5, 5, 'Available')
ON CONFLICT (asset_code) DO NOTHING;
