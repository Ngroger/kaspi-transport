const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const xml2js = require('xml2js');
const app = express();
const mysql = require('mysql2');
const util = require('util');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const db = mysql.createConnection({
    host: 'LOCAL_IP_ADDRESS',
    user: 'USERNAME',
    password: 'PASSWORD',
    database: 'DATABASE_NAME',
});

const port = 8022;

app.use(express.json());

app.get('/api-check/:pdfName', (req, res) => {
    console.log('/users')
    const pdfName = req.params.pdfName;
    console.log(pdfName);
    res.sendFile(path.join(__dirname, 'checks', pdfName));
});

async function generateAndSavePDF(txn_date, txn_id, sum, account) {
    const fileName = `transfer-receipt-${txn_date}.pdf`;
    const filePath = `checks/${fileName}`;
    
    // Форматируем и выводим дату транзакции
    const formattedDate = formatDate(txn_date);
    
    // Создаем новый PDF-документ
    const doc = new PDFDocument();

    // Регистрация шрифта
    const fontPath = './font/NotoSans-Regular.ttf'; // Путь к файлу шрифта
    doc.registerFont('CustomFont', fontPath);

    doc.font('CustomFont')

    // Загружаем логотип Kaspi.kz
    const logoUrl = "https://upload.wikimedia.org/wikipedia/ru/thumb/a/aa/Logo_of_Kaspi_bank.png/800px-Logo_of_Kaspi_bank.png";
    const logoResponse = await axios.get(logoUrl, { responseType: 'arraybuffer' });
    const logoImageData = Buffer.from(logoResponse.data, 'binary');

    // Вставляем логотип компании в PDF-документ
    doc.image(logoImageData, 10, 10, { width: 100 });

    doc.moveDown();
    doc.moveDown();
    doc.moveDown();
    doc
        .fontSize(18)
        .text(`Сумма:`, {continued:true, align: 'left'})
        .text(`${sum}`, {
            align: 'right'
        }).moveDown();
    doc
        .fontSize(18)
        .text(`№ Квитанции:`, {continued:true, align: 'left'})
        .text(`${txn_id}`, {
            align: 'right'
        }).moveDown();
    doc
        .fontSize(18)
        .text(`Дата и время`, {continued:true, align: 'left'})
        .text(`${formattedDate}`, {
            align: 'right'
        }).moveDown();
    doc
        .fontSize(18)
        .text(`Комиссия:`, {continued:true, align: 'left'})
        .text(`0 тг`, {
            align: 'right'
        }).moveDown();
    doc
        .fontSize(18)
        .text(`Отправитель:`, {continued:true, align: 'left'})
        .text(`Бутин Богдан Юрьевич`, {
            align: 'right'
        }).moveDown();
    doc
        .fontSize(18)
        .text(`Откуда:`, {continued:true, align: 'left'})
        .text(`Kaspi Pay`, {
            align: 'right'
        }).moveDown();

    // Генерируем QR-код
    const qrCodeUrl = `https://kaspi-transport.kz/api-check/${fileName}`;
    const qrCodeImage = await QRCode.toBuffer(qrCodeUrl);

    // Получаем ширину и высоту документа
    const docWidth = doc.page.width;
    const docHeight = doc.page.height;

    // Получаем ширину и высоту QR-кода
    const qrCodeWidth = 200; // Ширина QR-кода
    const qrCodeHeight = 200; // Высота QR-кода

    // Рассчитываем координаты для размещения QR-кода
    const qrCodeX = docWidth - qrCodeWidth - 10; // 10 - зазор от правого края
    const qrCodeY = docHeight - qrCodeHeight - 10; // 10 - зазор от нижнего края

    // Вставляем QR-код в PDF
    doc.image(qrCodeImage, qrCodeX, qrCodeY, { width: qrCodeWidth });
    
    // Сохраняем PDF-документ
    doc.pipe(fs.createWriteStream(filePath));
    doc.end();

    return fileName;
}

// Функция для форматирования даты
function formatDate(dateString) {
    const year = dateString.substr(0, 4);
    const month = dateString.substr(4, 2);
    const day = dateString.substr(6, 2);
    const hour = dateString.substr(8, 2);
    const minute = dateString.substr(10, 2);
    const second = dateString.substr(12, 2);

    return `${day}.${month}.${year} ${hour}:${minute}`;
}

function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

app.use(express.urlencoded({ extended: true }));

app.get('/api-kaspi', async (req, res) => {
    const { command, account, txn_id, sum, txn_date, data1 } = req.query;

    // Перемещение объявления xmlBuilder
    const xmlBuilder = new xml2js.Builder();

    try {
        // Проверяем значение параметра command
        if (command === 'check') {
            // Выполняем запрос к API Яндекса для проверки наличия водителя
            const yandexApiResponse = await checkDriver(account, data1);

            // Проверяем наличие водителя
            if (yandexApiResponse.success) {
                // Водитель найден, возвращаем XML-ответ с result равным 0
                const xmlSuccessResponse = xmlBuilder.buildObject({
                    response: {
                        txn_id: txn_id,
                        result: 0,
                        comment: ''
                    }
                });

                res.set('Content-Type', 'text/xml');
                res.send(xmlSuccessResponse);
            } else {
                // Водитель не найден, возвращаем XML-ответ с result равным 1
                const xmlNotFoundResponse = xmlBuilder.buildObject({
                    response: {
                        txn_id: txn_id,
                        result: 1,
                        comment: 'Driver not found'
                    }
                });

                res.set('Content-Type', 'text/xml');
                res.send(xmlNotFoundResponse);
            }
        } else if (command === 'pay') {
            // Выполняем запрос к API Яндекса для пополнения баланса
            const payResponse = await payBalance(account, data1, sum, txn_date, txn_id);

            if (payResponse.success) {
                // Пополнение прошло успешно, возвращаем XML-ответ с result равным 0
                const xmlPaySuccessResponse = xmlBuilder.buildObject({
                    response: {
                        txn_id: txn_id,
                        prv_txn: payResponse.prv_txn,
                        sum: sum,
                        result: 0,
                        comment: 'OK'
                    }
                });

                res.set('Content-Type', 'text/xml');
                res.send(xmlPaySuccessResponse);
            } else {
                // Ошибка при пополнении баланса, возвращаем XML-ответ с result равным 1
                const xmlPayErrorResponse = xmlBuilder.buildObject({
                    response: {
                        txn_id: txn_id,
                        result: 1,
                        comment: 'Error occurred while topping up balance'
                    }
                });

                res.set('Content-Type', 'text/xml');
                res.send(xmlPayErrorResponse);
            }
        } else {
            // Неизвестная команда, возвращаем XML-ответ с result равным 1
            const xmlUnknownCommandResponse = xmlBuilder.buildObject({
                response: {
                    txn_id: txn_id,
                    result: 1,
                    comment: 'Unknown command'
                }
            });

            res.set('Content-Type', 'text/xml');
            res.send(xmlUnknownCommandResponse);
        }
    } catch (error) {
        // Ошибка сервера, возвращаем XML-ответ с result равным 5
        console.error('Error:', error);
        const xmlServerErrorResponse = xmlBuilder.buildObject({
            response: {
                txn_id: txn_id,
                result: 5,
                comment: 'Internal Server Error'
            }
        });

        res.set('Content-Type', 'text/xml');
        res.send(xmlServerErrorResponse);
    }
});

// Функция для проверки наличия водителя
async function checkDriver(account, data1) {
    try {
        const [parkData] = await db.promise().query('SELECT * FROM parks WHERE id = ?', [data1]);

        if (parkData.length > 0) {
            const { apiKey, clientID, parkID } = parkData[0];

            // Формирование Body JSON для запроса к API Яндекса
            const requestBody = {
                "X-Client-ID": clientID,
                "X-Api-Key": apiKey,
                "X-Park-ID": parkID,
                "X-Idempotency-Token": uuidv4(),
                "content-type": "application/json"
            };

            const yandexApiResponse = await axios.post('https://fleet-api.taxi.yandex.net/v1/parks/driver-profiles/list', {
                "fields": {
                    "account": ["balance", "balance_limit", "currency", "id", "type"],
                    "car": ["amenities", "brand", "callsign", "category", "color", "id", "model", "number", "registration_cert", "status", "vin", "year"],
                    "current_status": ["status", "status_updated_at"],
                    "driver_profile": ["check_message", "comment", "created_date", "driver_license", "first_name", "id", "last_name", "middle_name", "park_id", "phones", "work_rule_id", "work_status"]
                },
                "limit": 1000,
                "offset": 0,
                "sort_order": [
                    {
                        "direction": "asc",
                        "field": "driver_profile.created_date"
                    }
                ],
                "query": {
                    "park": {
                        "id": parkID
                    }
                }
            }, {
                headers: requestBody
            });

            const driverProfiles = yandexApiResponse.data.driver_profiles;

            console.log("Ответ от Яндекса: ", driverProfiles);

            const [lastName, firstName, middleName] = account.split(" ").map(name => name.trim());

            console.log("full varian", account);
            console.log('Фамилия', lastName);
            console.log('Имя:', firstName);
            console.log('Отчество:', middleName);
        
            const matchingProfile = driverProfiles.find(profile =>
                profile.driver_profile.first_name == firstName ||
                profile.driver_profile.last_name == lastName ||
                profile.driver_profile.middle_name == middleName
            );

            if (matchingProfile) {
                console.log('Такой аккаунт есть');
                const driverProfileId = matchingProfile.driver_profile.id;
                return ({ success: true, driverProfileId: driverProfileId });
            }
        } else {
            return false;
        }
    } catch (error) {
        console.error('Error while checking driver:', error);
        return false;
    }
}

// Функция для пополнения баланса
async function payBalance(account, data1, sum, txn_date, txn_id) {
    try {
        const [parkData] = await db.promise().query('SELECT * FROM parks WHERE id = ?', [data1]);

        if (parkData.length > 0) {
            const { apiKey, clientID, parkID } = parkData[0];

            // Формирование Body JSON для запроса к API Яндекса
            const requestBody = {
                "X-Client-ID": clientID,
                "X-Api-Key": apiKey,
                "X-Park-ID": parkID,
                "X-Idempotency-Token": uuidv4(),
                "content-type": "application/json"
            };

            const checkResponse = await checkDriver(account, data1)

            if (checkResponse.success) {
                const editProfileRequestBody = {
                    "amount": sum,
                    "category_id": "partner_service_manual",
                    "description": "Пополнение",
                    "driver_profile_id": checkResponse.driverProfileId, 
                    "park_id": parkID
                };
    
                // Выполнение запроса на изменение профиля водителя для пополнения баланса
                const editProfileResponse = await axios.post(`https://fleet-api.taxi.yandex.net/v2/parks/driver-profiles/transactions`, editProfileRequestBody, {
                    headers: requestBody
                });
    
                const pdfFileName = generateAndSavePDF(txn_date, txn_id, sum, account);
    
                // Возвращаем успешный результат пополнения
                return { success: true, prv_txn: editProfileResponse.data.transaction_id, pdfFileName: pdfFileName};
            } else {
                return { success: false }
            }
        } else {
            // Парк не найден
            return { success: false };
        }
    } catch (error) {
        console.error('Error while paying balance:', error);
        return { success: false };
    }
}

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
