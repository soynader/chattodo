require("dotenv/config");
const mysql = require('mysql2');

// Configuración de la conexión a la base de datos
const connection = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    database: process.env.MYSQL_DATABASE,
    password: process.env.MYSQLPASSWORD,
    port: parseInt(process.env.MYSQLPORT, 10),
});

// Conectar a la base de datos
connection.connect(function(err) {
  if (err) throw err;
  console.log('Connected to the database!');
});

// Función para obtener la API key
function obtenerApiKey(nombreServicio) {
  return new Promise((resolve, reject) => {
    if (!nombreServicio) {
      console.error('Service name is undefined or null');
      return resolve(null);
    }

    connection.query('SELECT api_key FROM apikeys WHERE service_name = ?', [nombreServicio], function (error, results, fields) {
      if (error) {
        console.error('Error obtaining API key:', error);
        return resolve(null);
      }
      if (results.length === 0) {
        console.error('API key not found for service:', nombreServicio);
        return resolve(null);
      }
      resolve(results[0].api_key);
    });
  });
}

// Exportar la función para obtener la API key
module.exports = obtenerApiKey;

// Nota: No cerramos la conexión aquí para que pueda ser utilizada posteriormente
