/**
 * Class to generate HTML table as text.
 */
class HtmlTable {
    constructor(awardsImages, noData) {
        this.contents = `<html>
        <head>
        <style type="text/css">
            .tg {border-collapse:collapse;border-spacing:0;}
            .tg td{border-color:black;border-style:solid;border-width:2px;font-family:Arial, sans-serif;font-size:14px;overflow:hidden;padding:10px 5px;word-break:normal;}
            .tg th{border-color:black;border-style:solid;border-width:2px;font-family:Arial, sans-serif;font-size:14px;font-weight:normal;overflow:hidden;padding:10px 5px;word-break:normal;}
            .tg .tg-table-cell{text-align:center;vertical-align:center;}
            .tg .tg-table-cell-no-data{text-align:center;vertical-align:center;font-weight:bold;}
            .tg .tg-first-column{font-weight:bold;text-align:left;vertical-align:center;}
            .tg .tg-total-column{font-weight:bold;text-align:right;vertical-align:center;}            
            .tg img{width:32px;height:32px;}
        </style>
        </head>
        <body>
        <table class="tg" id="mainTable">
        <thead>
        <tr>
        <th class="tg-table-cell">${noData ? '<div style="width:39px;"></div>' : ''}</th>`; // Number 39 was carefully calculated so that the cell width would precisely match width of the last "Score" cell :)

        awardsImages.forEach(item => {
            this.contents += `<th class="tg-table-cell"><img src="{{${item.name}}}" alt="${item.description}"/></th>`;
        });

        this.contents += '<th class="tg-total-column">Score</th></tr></thead><tbody>';
    }

    /**
     * Function to add HTML table single row and populate values for scores for each reward as well as the total score.
     * @param {String} userName Name of the user to display in the first column.
     * @param {Array<Number>} awards Array of values containing number of each award and also total score as last element.
     */
    addUserAwardsRow(userName, awards) {
        let rowContents = '<tr>';
        rowContents += `<td class="tg-first-column">${userName}</td>`;

        // Last element contains total score and is going to be in a separate style column
        awards.slice(0, -1).forEach(award => {
            rowContents += `<td class="tg-table-cell">${award === 0 ? '' : award}</td>`;
        });

        rowContents += `<td class="tg-total-column">${awards.pop()}</td></tr>`;

        this.contents += rowContents;
    };

    /**
     * Function to add empty row to the table in case there is no data to be rendered.
     * @param {Number} colspanNum Number of total columns to merge.
     */
    addEmptyDataRow(colspanNum) {
        this.contents += `<tr><td class="tg-table-cell-no-data" colspan="${colspanNum}">Sorry, nothing on the record yet</td></tr>`;
    }

    /**
     * Function to add closing HTML tags to the end of the document.
     */
    complete() {
        this.contents += '</tbody></table></body></html>'
    };
}

/**
 * Utility class to generate HTML table object based on input data.
 */
class HtmlTableHelper {
    static generateHTMLTable(awards, userStats) {
        const htmlTable = new HtmlTable(awards.map(award => { return { name: award._id, description: award.userText } }), Object.entries(userStats).length === 0);

        if (Object.entries(userStats).length === 0) {
            htmlTable.addEmptyDataRow(awards.length + 2); // +2 because we have one empty cell in the beginning and one extra cell at the end for total score
        }
        else {
            userStats.forEach(userStat => { htmlTable.addUserAwardsRow(userStat.displayName, userStat.awardsCount) });
        }

        htmlTable.complete();

        return htmlTable;
    }
}

module.exports = {
    HtmlTableHelper
};