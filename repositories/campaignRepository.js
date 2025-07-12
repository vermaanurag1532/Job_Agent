let campaigns = [];

class CampaignRepository {
    getAllCampaigns() {
        return campaigns;
    }

    getCampaignById(id) {
        return campaigns.find(c => c.id === id);
    }

    addCampaign(campaign) {
        campaigns.push(campaign);
        return campaign;
    }

    updateCampaign(id, updateData) {
        const campaignIndex = campaigns.findIndex(c => c.id === id);
        if (campaignIndex !== -1) {
            campaigns[campaignIndex] = { ...campaigns[campaignIndex], ...updateData };
            return campaigns[campaignIndex];
        }
        return null;
    }

    deleteCampaign(id) {
        const campaignIndex = campaigns.findIndex(c => c.id === id);
        if (campaignIndex !== -1) {
            const deletedCampaign = campaigns.splice(campaignIndex, 1)[0];
            return deletedCampaign;
        }
        return null;
    }

    setCampaigns(newCampaigns) {
        campaigns = newCampaigns;
    }
}

export const campaignRepository = new CampaignRepository();