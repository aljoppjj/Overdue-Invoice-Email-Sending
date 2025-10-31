/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/email', 'N/file', 'N/record', 'N/log'],
    function (search, email, file, record, log) {

        /**
         * Main entry point for the scheduled script.
         * @returns {void}
         */
        function execute() {
            const customerInvoices = getOverdueInvoices();
            if (!customerInvoices || Object.keys(customerInvoices).length === 0) {
                log.audit('No Invoices Found', 'No overdue invoices were found for the previous month.');
                return;
            }

            notifyCustomers(customerInvoices);
        }

        /**
         * Retrieves overdue invoices grouped by customer.
         * @returns {Object} A map of customer IDs to arrays of invoice details.
         */
        function getOverdueInvoices() {
            const invoiceSearch = search.create({
                type: search.Type.INVOICE,
                filters: [
                    ['status', 'anyof', 'CustInvc:A'],
                    'AND',
                    ['duedate', 'before', 'lastmonth']
                ],
                columns: [
                    'entity',
                    'tranid',
                    'amount',
                    'duedate',
                    'salesrep'
                ]
            });

            const customerInvoices = {};
            const invoiceResults = invoiceSearch.run();

            invoiceResults.each(function (result) {
                const customerId = result.getValue('entity');
                if (!customerId) return true;

                const invoiceNumber = result.getValue('tranid');
                const amount = result.getValue('amount');
                const dueDate = new Date(result.getValue('duedate'));
                const daysOverdue = Math.floor((new Date() - dueDate) / (1000 * 60 * 60 * 24));

                if (!customerInvoices[customerId]) {
                    customerInvoices[customerId] = [];
                }

                customerInvoices[customerId].push({
                    invoiceNumber,
                    amount,
                    daysOverdue
                });

                return true;
            });

            return customerInvoices;
        }

        /**
         * Sends overdue invoice notifications to each customer.
         * @param {Object} customerInvoices - A map of customer IDs to arrays of invoice details.
         * @returns {void}
         */
        function notifyCustomers(customerInvoices) {
            for (const customerId in customerInvoices) {
                try {
                    const customerRecord = record.load({ type: record.Type.CUSTOMER, id: customerId });
                    const customerName = customerRecord.getValue('companyname') || customerRecord.getValue('firstname');
                    const customerEmail = customerRecord.getValue('email');
                    const salesRepId = customerRecord.getValue('salesrep');

                    if (!customerEmail) continue;

                    const senderId = getSenderId(salesRepId);

                    const csvFile = generateCsvFile(customerName, customerInvoices[customerId]);

                    email.send({
                        author: senderId,
                        recipients: customerEmail,
                        subject: 'Overdue Invoice Notification',
                        body: `Dear ${customerName},\n\nPlease find attached your overdue invoices.`,
                        attachments: [csvFile]
                    });

                } catch (e) {
                    log.error('Email Error', `Failed to send email to customer ID ${customerId}: ${e.message}`);
                }
            }
        }

        /**
         * Determines the sender ID based on the sales rep's email availability.
         * @param {number|string} salesRepId - The internal ID of the sales rep.
         * @returns {number} The sender ID to use for the email.
         */
        function getSenderId(salesRepId) {
            let senderId = -5;
            if (salesRepId) {
                try {
                    const salesRepRecord = record.load({ type: record.Type.EMPLOYEE, id: salesRepId });
                    const salesRepEmail = salesRepRecord.getValue('email');
                    if (salesRepEmail) {
                        senderId = salesRepId;
                    }
                } catch (e) {
                    log.error('Sales Rep Load Error', `Could not load sales rep record for ID ${salesRepId}: ${e.message}`);
                }
            }
            return senderId;
        }

        /**
         * Generates a CSV file containing overdue invoice details.
         * @param {string} customerName - The name of the customer.
         * @param {Array} invoices - Array of invoice objects with invoiceNumber, amount, and daysOverdue.
         * @returns {File} A NetSuite file object representing the CSV.
         */
        function generateCsvFile(customerName, invoices) {
            let csvContent = 'Invoice Number,Amount,Days Overdue\n';
            invoices.forEach(inv => {
                csvContent += `${inv.invoiceNumber},${inv.amount},${inv.daysOverdue}\n`;
            });

            return file.create({
                name: `Overdue_Invoices_${customerName}.csv`,
                fileType: file.Type.CSV,
                contents: csvContent
            });
        }

        return { execute };
    });
