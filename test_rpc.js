async function testRpc() {
  const url = 'https://kzuvqvxkrjiyuxontzar.supabase.co/rest/v1/rpc/koreksi_dan_submit';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6dXZxdnhrcmppeXV4b250emFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxOTU3MjcsImV4cCI6MjEwNTc3MTcyN30.YImK_izAtHa_7ZZxjq2tpQy2agv1iuoOTtjH5UNX_vM';
  
  const payload = {
    p_id_row: "1",
    p_nama: "test",
    p_kelas: "test",
    p_mapel: "test",
    p_jawaban: [{ id: "2", tipe: "PG", jawaban: "A" }],
    p_pelanggaran: "0",
    p_durasi: "test",
    p_status: "SELESAI"
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  console.log("Status:", response.status);
  console.log("Response:", text);
}

testRpc();
