/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
 
/************************************************************************************************
 *  
 * OTP-9709 : Monthly Sales Notification for Sales Rep
 *
*************************************************************************************************
 *
 * Author: Jobin and Jismi IT Services
 *
 * Date Created : 29-October-2025
 *
 * Description : This script Sends monthly emails to customers with all overdue invoices 
 *               (till previous month) as a CSV,using Sales Rep or Admin as sender.(If
 *                sales rep doesnt have mailid then use admin mail)
 *                  
 *                 
 *
 * REVISION HISTORY
 *
 * @version 1.0 : 29-October-2025 :  The initial build was created by JJ0417
 *
*************************************************************************************************/

define(['N/search', 'N/email', 'N/file', 'N/log'],
    function (search, email, file, log) {

        /**
         * Main execution function for scheduled script
         * Searches for overdue invoices and sends email notifications to customers
         * @param {Object} context - Script context object
         */
        function execute(context) {
            try {
                log.audit('Script Started', 'Monthly Overdue Invoice Email Notification');

                const customerInvoices = searchOverdueInvoices();

                if (Object.keys(customerInvoices).length === 0) {
                    log.audit('No Invoices Found', 'No overdue invoices were found for the previous month.');
                    return;
                }

                log.audit('Customers to Notify', `Total customers with overdue invoices: ${Object.keys(customerInvoices).length}`);

                processCustomerNotifications(customerInvoices);

                log.audit('Script End', 'Overdue Invoice Email Notification script completed successfully.');

            } catch (e) {
                log.error('Script Execution Error', `Fatal error in execute function: ${e.message}`);
                throw e;
            }
        }

        /**
         * Searches for all overdue invoices till last month
         * @returns {Object} Object with customer IDs as keys and array of invoice details as values
         */
        function searchOverdueInvoices() {
            try {
                const invoiceSearch = search.create({
                    type: search.Type.INVOICE,
                    filters: [
                        ['status', 'anyof', 'CustInvc:A'],
                        'AND',
                        ['duedate', 'before', 'lastmonth'],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['entity', 'tranid', 'amount', 'duedate']
                });

                const customerInvoices = {};
                const invoiceResults = invoiceSearch.run();
                let invoiceCount = 0;
                const processedInvoices = {};

                invoiceResults.each(function (result) {
                    try {
                        const customerId = result.getValue('entity');
                        const invoiceNumber = result.getValue('tranid');

                        if (!customerId) {
                            return true;
                        }

                        const invoiceKey = `${customerId}_${invoiceNumber}`;
                        if (processedInvoices[invoiceKey]) {
                            return true;
                        }
                        processedInvoices[invoiceKey] = true;

                        invoiceCount++;

                        const amount = result.getValue('amount');
                        const dueDate = new Date(result.getValue('duedate'));
                        const daysOverdue = Math.floor((new Date() - dueDate) / (1000 * 60 * 60 * 24));

                        if (!customerInvoices[customerId]) {
                            customerInvoices[customerId] = [];
                        }

                        customerInvoices[customerId].push({
                            invoiceNumber: invoiceNumber,
                            amount: amount,
                            daysOverdue: daysOverdue
                        });

                        return true;
                    } catch (e) {
                        log.error('Invoice Processing Error', `Error processing invoice: ${e.message}`);
                        return true;
                    }
                });

                log.audit('Invoices Found', `Total unique overdue invoices: ${invoiceCount}`);
                

                for (const customerId in customerInvoices) {
                    log.audit('Customer Invoices', `Customer ID ${customerId}: ${customerInvoices[customerId].length} invoices - ${customerInvoices[customerId].map(inv => inv.invoiceNumber).join(', ')}`);
                }

                return customerInvoices;

            } catch (e) {
                log.error('Search Error', `Error searching overdue invoices: ${e.message}`);
                throw e;
            }
        }

        /**
         * Processes and sends email notifications to all customers with overdue invoices
         * @param {Object} customerInvoices - Object containing customer IDs and their invoice details
         */
        function processCustomerNotifications(customerInvoices) {
            for (const customerId in customerInvoices) {
                try {
                    sendCustomerEmail(customerId, customerInvoices[customerId]);
                } catch (e) {
                    log.error('Customer Processing Error', `Failed to process customer ID ${customerId}: ${e.message}`);
                }
            }
        }

        /**
         * Sends email notification to a specific customer with their overdue invoices
         * @param {string} customerId - NetSuite internal ID of the customer
         * @param {Array} invoices - Array of invoice objects containing invoice details
         */
        function sendCustomerEmail(customerId, invoices) {
            try {
                const customerFields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['companyname', 'firstname', 'email', 'salesrep']
                });

                const customerName = customerFields.companyname || customerFields.firstname || 'Customer';
                const customerEmail = customerFields.email;
                const salesRepId = customerFields.salesrep && customerFields.salesrep.length > 0 ? customerFields.salesrep[0].value : null;

                if (!customerEmail) {
                    log.error('Missing Email', `Customer ${customerName} (ID: ${customerId}) has no email. Skipping.`);
                    return;
                }

                const senderId = getSenderId(salesRepId, customerName);
                const csvFile = createCSVFile(customerName, customerEmail, invoices);

                email.send({
                    author: senderId,
                    recipients: customerEmail,
                    subject: 'Overdue Invoice Notification',
                    body: `Dear ${customerName},\n\nPlease find attached your overdue invoices.`,
                    attachments: [csvFile]
                });

                log.audit('Email Sent', `Email sent to ${customerEmail} with ${invoices.length} overdue invoices.`);

            } catch (e) {
                log.error('Email Send Error', `Failed to send email to customer ID ${customerId}: ${e.message}`);
                throw e;
            }
        }

        /**
         * Determines the sender ID for the email (Sales Rep or Admin)
         * @param {string} salesRepId - NetSuite internal ID of the sales rep
         * @param {string} customerName - Name of the customer (for logging)
         * @returns {number} Sender ID (-5 for admin or sales rep ID)
         */
        function getSenderId(salesRepId, customerName) {
            try {
                if (!salesRepId) {
                    return -5;
                }

                const salesRepFields = search.lookupFields({
                    type: search.Type.EMPLOYEE,
                    id: salesRepId,
                    columns: ['email']
                });

                const salesRepEmail = salesRepFields.email;

                if (salesRepEmail) {
                    return parseInt(salesRepId);
                } else {
                    log.audit('Sales Rep Missing Email', `Sales rep for customer ${customerName} has no email. Using admin ID.`);
                    return -5;
                }

            } catch (e) {
                log.error('Sales Rep Load Error', `Could not load sales rep record for ID ${salesRepId}: ${e.message}`);
                return -5;
            }
        }

        /**
         * Creates a CSV file with overdue invoice details
         * @param {string} customerName - Name of the customer
         * @param {string} customerEmail - Email of the customer
         * @param {Array} invoices - Array of invoice objects
         * @returns {File} NetSuite file object containing CSV data
         */
        function createCSVFile(customerName, customerEmail, invoices) {
            try {
                let csvContent = 'Customer Name,Customer Email,Invoice Document Number,Invoice Amount,Days Overdue\n';

                invoices.forEach(function(inv) {
                    csvContent += `"${customerName}","${customerEmail}",${inv.invoiceNumber},${inv.amount},${inv.daysOverdue}\n`;
                });

                const csvFile = file.create({
                    name: `Overdue_Invoices_${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 1226
                });

                const fileId = csvFile.save();
                log.debug('CSV File Created', `File ID: ${fileId} for customer ${customerName}`);

                return file.load({ id: fileId });

            } catch (e) {
                log.error('CSV Creation Error', `Error creating CSV file for ${customerName}: ${e.message}`);
                throw e;
            }
        }

        return { execute: execute };
    });
