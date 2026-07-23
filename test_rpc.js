async function testRpc() {
  const url = 'https://bkecjfrwqocguyvjymkn.supabase.co/rest/v1/rpc/koreksi_dan_submit';
  const key = 'sb_publishable_4sQqxzUTiVhuf2h4SZCqNA_txpH0J8C';
  
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
