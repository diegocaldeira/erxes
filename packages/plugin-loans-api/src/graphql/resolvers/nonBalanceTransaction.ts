import { IContext } from '../../connectionResolver';
import { sendMessageBroker } from '../../messageBroker';
import { INonBalanceTransaction } from '../../models/definitions/nonBalanceTransactions';

const nonBalanceTransactions = {

  customer(nonBalanceTransaction: INonBalanceTransaction, _, { subdomain }: IContext) {
    return sendMessageBroker(
      {
        subdomain,
        action: 'customers.findOne',
        data: { _id: nonBalanceTransaction.customerId },
        isRPC: true
      },
      'contacts'
    );
  },
  contract(nonBalanceTransaction: INonBalanceTransaction, _, { models }: IContext) {
    return models.Contracts.findOne({ _id: nonBalanceTransaction.contractId });
  }
};

export default nonBalanceTransactions;
