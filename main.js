const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;
const XLSX = require('xlsx');

let customers = [];
let customerIdCounter = 1;
let rejectionReason = '';

app.use(bodyParser.json());

app.post('/register', (req, res) => {
    try {
        const { first_name, last_name, age, monthly_income, phone_number } = req.body;
        const approved_limit = Math.round(36 * monthly_income / 100000) * 100000;
        const newCustomer = {
            customer_id: customerIdCounter++,
            name: `${first_name} ${last_name}`,
            age,
            monthly_income,
            approved_limit,
            phone_number
        };
        customers.push(newCustomer);
        res.status(201).json({
            message: "Successfully registered",
            customer: newCustomer
        });
    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const loanDataWorkbook = XLSX.readFile('loan_data.xlsx');
const loanDataSheet = loanDataWorkbook.Sheets[loanDataWorkbook.SheetNames[0]];
const loanData = XLSX.utils.sheet_to_json(loanDataSheet);

const customerDataWorkbook = XLSX.readFile('customer_data.xlsx');
const customerDataSheet = customerDataWorkbook.Sheets[customerDataWorkbook.SheetNames[0]];
const customerData = XLSX.utils.sheet_to_json(customerDataSheet);

app.post('/check-eligibility', (req, res) => {
    try {
        const { customer_id, loan_amount, interest_rate, tenure } = req.body;
        const monthly_salary = getMonthlySalaryFromSheet(customer_id);
        const creditScore = calculateCreditScore(customer_id, loanData, monthly_salary);
        let canApproveLoan = false;
        let correctedInterestRate = interest_rate;

        if (creditScore > 50) {
            canApproveLoan = true;
        } else if (creditScore > 30) {
            if (interest_rate > 12) {
                correctedInterestRate = 12;
            }
            canApproveLoan = true;
        } else if (creditScore > 10) {
            if (interest_rate > 16) {
                correctedInterestRate = 16;
            }
            canApproveLoan = true;
        }

        const totalEMIs = calculateTotalEMIs(customer_id, loanData);
        const totalEMIsThreshold = monthly_salary * 0.5;
        if (totalEMIs > totalEMIsThreshold) {
            canApproveLoan = false;
            rejectionReason = 'Sum of all current EMIs exceeds 50% of monthly salary';
        }

        if (creditScore <= 10) {
            rejectionReason = 'Credit score is less than or equal to 10';
            canApproveLoan = false;
        }

        if (!canApproveLoan) {
            correctedInterestRate = 0;
        }
        const monthly_installment = calculateMonthlyInstallment(loan_amount, correctedInterestRate, tenure);

        res.status(200).json({
            customer_id,
            approval: canApproveLoan,
            interest_rate,
            correctedInterestRate,
            tenure,
            monthly_installment
        });

    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function getMonthlySalaryFromSheet(customer_id) {
    try {
        for (const row of customerData) {
            const customerIdInSheet = row['customer_id'];

            if (customerIdInSheet === customer_id) {
                const monthlySalary = parseFloat(row['Monthly Salary']);
                return isNaN(monthlySalary) ? 0 : monthlySalary;
            }
        }
        return 0;
    } catch (error) {
        console.error('Error occurred while reading customer data:', error);
        return 0;
    }
}

function calculateTotalEMIs(customer_id, loanData) {
    if (!loanData || loanData.length === 0) {
        return 0;
    }
    const customerLoans = loanData.filter(loan => loan['Customer ID'] === customer_id);
    let totalEMIs = 0;
    customerLoans.forEach(loan => {
        totalEMIs += parseFloat(loan['Monthly payment']);
    });
    return totalEMIs;
}

function calculateCreditScore(customer_id, loanData) {
    const customerLoans = loanData.filter(loan => loan['Customer ID'] === customer_id);
    let creditScore = 100;
    const totalLoans = customerLoans.length;
    let totalEMIsPaidOnTime = 0;
    let totalLoanAmount = 0;
    customerLoans.forEach(loan => {
        if (loan['EMIs paid on Time'] === 'Yes') {
            totalEMIsPaidOnTime++;
        }
        totalLoanAmount += loan['Loan Amount'];
    });
    const currentYear = new Date().getFullYear();
    const currentYearLoans = customerLoans.filter(loan => new Date(loan['Date of Approval']).getFullYear() === currentYear);
    const currentYearLoanCount = currentYearLoans.length;
    if (currentYearLoanCount > 3) {
        creditScore -= (currentYearLoanCount - 3) * 10;
    }
    const customerApprovedLimit = 36 * 50000;
    if (totalLoanAmount > customerApprovedLimit) {
        creditScore = 0;
    }
    return Math.max(creditScore, 0);
}

function calculateMonthlyInstallment(loan_amount, interest_rate, tenure) {
    const monthlyInterestRate = interest_rate / 100 / 12;
    const numerator = loan_amount * monthlyInterestRate;
    const denominator = 1 - Math.pow(1 + monthlyInterestRate, -tenure);
    const monthly_installment = numerator / denominator;
    return Math.round(monthly_installment * 100) / 100;
}

const axios = require('axios');

async function checkEligibility(customer_id, loan_amount, interest_rate, tenure) {
    try {
        const response = await axios.post('http://localhost:3000/check-eligibility', {
            customer_id,
            loan_amount,
            interest_rate,
            tenure
        });
        return response.data;
    } catch (error) {
        console.error('Error checking loan eligibility:', error);
        throw new Error('Error checking loan eligibility: ' + error.message);
    }
}

app.post('/create-loan', async (req, res) => {
    try {
        const { customer_id, loan_amount, interest_rate, tenure } = req.body;
        const eligibilityResponse = await checkEligibility(customer_id, loan_amount, interest_rate, tenure);
        let loan_id = null;
        let loan_approved = false;
        let message = '';
        if (eligibilityResponse.approval) {
            loan_id = Math.floor(Math.random() * 1000) + 1;
            loan_approved = true;
            message = 'Loan approved';
        } else {
            message = 'Loan not approved: ' + rejectionReason;
        }
        const response = {
            loan_id,
            customer_id,
            loan_approved,
            message,
            monthly_installment: loan_approved ? eligibilityResponse.monthly_installment : 0
        };
        res.status(200).json(response);
    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/view-loan/:loan_id', (req, res) => {
    try {
        const loan_id = parseInt(req.params.loan_id);
        const loan = loanData.find(loan => loan['Loan ID'] === loan_id);
        if (loan) {
            const customer_id = loan['Customer ID'];
            const customer = customerData.find(customer => customer['Customer ID'] === customer_id);
            let customerDetails = {};
            if (customer) {
                customerDetails = {
                    id: customer['Customer ID'],
                    first_name: customer['First Name'],
                    last_name: customer['Last Name'],
                    phone_number: customer['Phone Number'],
                    age: customer['Age']
                };
            } else {
                customerDetails = {
                    id: customer_id,
                    first_name: 'NA',
                    last_name: 'NA',
                    phone_number: 'NA',
                    age: 'NA'
                };
            }
            const response = {
                loan_id: loan_id,
                customer: customerDetails,
                loan_amount: loan['Loan Amount'],
                interest_rate: loan['Interest Rate'],
                monthly_installment: loan['Monthly payment'],
                tenure: loan['Tenure']
            };
            res.status(200).json(response);
        } else {
            res.status(404).json({ error: 'Loan not found' });
        }
    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/make-payment/:customer_id/:loan_id', (req, res) => {
    try {
        const { customer_id, loan_id } = req.params;
        const { amount } = req.body;
        const loanDetails = loanData.find(loan => loan['Customer ID'] === parseInt(customer_id) && loan['Loan ID'] === parseInt(loan_id));
        if (!loanDetails) {
            res.status(404).json({ error: 'Loan not found' });
            return;
        }
        const remainingLoanAmount = calculateRemainingLoan(loanDetails, amount);
        if (remainingLoanAmount == 0) {
            res.status(400).json({ error: 'Amount already cleared' });
            return;
        }
        if (remainingLoanAmount < 0) {
            res.status(400).json({ error: 'Amount exceeding the entire loan amount' });
            return;
        }
        const monthlyInstallment = loanDetails['Monthly payment'];
        const pendingEMIs = Math.floor(remainingLoanAmount / monthlyInstallment);
        let message = '';
        if (pendingEMIs > 0) {
            message = `Successfully paid and ${pendingEMIs} remaining EMI(s) left`;
        } else if (remainingLoanAmount === 0) {
            message = 'Successfully paid the entire loan amount. 0 pending amount.';
        } else {
            const monthlyEMI = calculateMonthlyEMI(loanDetails);
            const remainingLoanMonths = Math.ceil(remainingLoanAmount / monthlyEMI);
            message = `Successfully paid monthly EMI and remaining loan left is ${remainingLoanMonths} month(s)`;
        }
        const response = {
            loan_id: loanDetails.loan_id,
            customer: {
                id: loanDetails.customer_id,
                first_name: loanDetails.first_name,
                last_name: loanDetails.last_name,
                phone_number: loanDetails.phone_number,
                age: loanDetails.age
            },
            loan_amount: loanDetails.loan_amount,
            interest_rate: loanDetails.interest_rate,
            monthly_installment: loanDetails.monthly_installment,
            tenure: loanDetails.tenure,
            message: message
        };
        res.status(200).json(response);
    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function calculateRemainingLoan(loanDetails, amount) {
    const emisPaid = loanDetails['EMIs paid on Time'];
    const loanAmount = loanDetails['Loan Amount'];
    const interestRate = loanDetails['Interest Rate'] / 100;
    const tenure = loanDetails['Tenure'];
    const monthlyInstallment = loanDetails['Monthly payment'];
    const remainingInstallments = tenure - emisPaid;
    const remainingInterest = (loanAmount * interestRate * remainingInstallments);
    const remainingLoanAmount = (remainingInstallments * monthlyInstallment) + remainingInterest - amount;
    return remainingLoanAmount;
}

function calculateMonthlyEMI(loan_amount, interest_rate, tenure) {
    const monthlyInterestRate = interest_rate / 12 / 100;
    const numerator = loan_amount * monthlyInterestRate * Math.pow(1 + monthlyInterestRate, tenure);
    const denominator = Math.pow(1 + monthlyInterestRate, tenure) - 1;
    const monthlyInstallment = numerator / denominator;
    return monthlyInstallment;
}

app.get('/view-statement/:customer_id/:loan_id', (req, res) => {
    try {
        const { customer_id, loan_id } = req.params;
        const loanDetails = loanData.find(loan => loan['Customer ID'] === parseInt(customer_id) && loan['Loan ID'] === parseInt(loan_id));
        if (!loanDetails) {
            return res.status(404).json({ error: 'Loan details not found' });
        }
        const loanAmount = loanDetails['Loan Amount'];
        const interestRate = loanDetails['Interest Rate'] / 100;
        const emisPaid = loanDetails['EMIs paid on Time'];
        const tenure = loanDetails['Tenure'];
        const remainingInstallments = tenure - emisPaid;
        const remainingInterest = (loanAmount * interestRate * remainingInstallments);
        const remainingLoanAmount = calculateRemainingLoan(loanDetails);
        const repaymentsLeft = tenure - emisPaid;
        const monthlyInstallment = loanDetails['Monthly payment'];
        const amountPaid = monthlyInstallment * emisPaid;
        const response = {
            customer_id,
            loan_id,
            principle_amount: (remainingInstallments * monthlyInstallment) + remainingInterest,
            interest_rate: loanDetails['Interest Rate'],
            amount_paid: amountPaid,
            monthly_installment: monthlyInstallment,
            repayments_left: repaymentsLeft
        };
        res.status(200).json(response);
    } catch (error) {
        console.error('Error occurred while processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
