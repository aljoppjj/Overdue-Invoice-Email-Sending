/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */

define(['N/search', 'N/email', 'N/file', 'N/runtime', 'N/record', 'N/log'],
    function (search, email, file, runtime, record, log) {
        function execute(context) {

            log.audit('Script Started');

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
            let invoiceCount = 0;

            invoiceResults.each(function (result) {
                const customerId = result.getValue('entity');
                if (!customerId) {
                    log.error('Missing Customer ID', 'Skipping invoice with no customer ID.');
                    return true;
                }

                invoiceCount++;

                const invoiceNumber = result.getValue('tranid');
                const amount = result.getValue('amount');
                const dueDate = new Date(result.getValue('duedate'));
                const daysOverdue = Math.floor((new Date() - dueDate) / (1000 * 60 * 60 * 24));

                log.debug('Invoice Found', `Customer ID: ${customerId}, Invoice: ${invoiceNumber}, Amount: ${amount}, Days Overdue: ${daysOverdue}`);

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

            if (invoiceCount === 0) {
                log.audit('No Invoices Found', 'No overdue invoices were found for the previous month.');
                return;
            }

            log.audit('Invoices Found', `Total overdue invoices: ${invoiceCount}`);
            log.audit('Customers to Notify', `Total customers with overdue invoices: ${Object.keys(customerInvoices).length}`);

            for (const customerId in customerInvoices) {
                try {
                    const customerRecord = record.load({ type: record.Type.CUSTOMER, id: customerId });
                    const customerName = customerRecord.getValue('companyname') || customerRecord.getValue('firstname');
                    const customerEmail = customerRecord.getValue('email');
                    const salesRepId = customerRecord.getValue('salesrep');

                    if (!customerEmail) {
                        log.error('Missing Email', `Customer ${customerName} (ID: ${customerId}) has no email. Skipping.`);
                        continue;
                    }

                    const senderId = salesRepId || runtime.getCurrentUser().id;

                    log.audit('Preparing Email', `Customer: ${customerName}, Email: ${customerEmail}, Sender ID: ${senderId}`);

                    let csvContent = 'Invoice Number,Amount,Days Overdue\n';
                    customerInvoices[customerId].forEach(inv => {
                        csvContent += `${inv.invoiceNumber},${inv.amount},${inv.daysOverdue}\n`;
                    });

                    const csvFile = file.create({
                        name: `Overdue_Invoices_${customerName}.csv`,
                        fileType: file.Type.CSV,
                        contents: csvContent
                    });

                    email.send({
                        author: senderId,
                        recipients: customerEmail,
                        subject: 'Overdue Invoice Notification',
                        body: `Dear ${customerName},\n\nPlease find attached your overdue invoices`,
                        attachments: [csvFile]
                    });

                    log.audit('Email Sent', `Email sent to ${customerEmail} with ${customerInvoices[customerId].length} overdue invoices.`);
                } catch (e) {
                    log.error('Email Error', `Failed to send email to customer ID ${customerId}: ${e.message}`);
                }
            }

            log.audit('Script End', 'Overdue Invoice Email Notification script completed.');
        }

        return { execute };
    });
