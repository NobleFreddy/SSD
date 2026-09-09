/**
 * ============================================================================
 * SSD.SupabaseConfig — Verbindungsdaten der gemeinsamen Cloud-Datenbank
 * ============================================================================
 * Der "anon"/"publishable" Schlüssel ist bei Supabase bewusst dafür gedacht,
 * öffentlich im Client-JavaScript zu stehen — er ersetzt keine Zugriffs-
 * kontrolle, diese erfolgt über Row-Level-Security-Regeln auf der Tabelle
 * selbst (siehe Migration `create_ssd_dienstplan_state`) sowie weiterhin über
 * den Login-Bildschirm der Anwendung. Ohne eigenes Backend hat die App keine
 * Möglichkeit, diesen Schlüssel zu verstecken — das ist bei rein clientseitigen
 * Supabase-Anwendungen so vorgesehen.
 */
window.SSD = window.SSD || {};

SSD.SupabaseConfig = {
  URL: 'https://efhqaurepdqmncwqjxmd.supabase.co',
  // Bewusst der ältere, JWT-basierte "anon"-Schlüssel statt des neueren
  // "sb_publishable_..."-Formats: Letzterer wurde bei Tests vom Realtime-
  // Websocket-Handshake dieses Projekts abgelehnt ("closed before the
  // connection is established"), während der klassische JWT-Schlüssel sowohl
  // für normale Abfragen als auch für Realtime-Abonnements funktioniert.
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmaHFhdXJlcGRxbW5jd3FqeG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDY1MTgsImV4cCI6MjEwMzkyMjUxOH0.HNbxmEXTnuZra24WiR3fbDp_dusrij6ML0cv6POQRXw',
  TABLE: 'ssd_dienstplan_state',
  ROW_ID: 1,
};
